//! Bounded, prioritized, single-flight decode scheduler (Phase 2).
//!
//! All decode-class work (preview/display/viewport/enhance decodes, thumbnails,
//! samples, clipboard preparation) is routed through this scheduler. It does
//! three things and **never cancels a running job**:
//!
//! 1. **Single-flight** — duplicate or returning (navigate-away-and-back)
//!    requests for the same key join the in-flight leader's future via
//!    `moka::future::Cache::get_with`, so the heavy decode runs exactly once and
//!    the (cloned) result is delivered to every caller. Single-flight runs
//!    *first*, so followers never enter the queue and never take a permit.
//! 2. **Priority admission** — the leader pushes itself into a bounded priority
//!    queue (a `BinaryHeap` behind a `parking_lot::Mutex`) ordered by
//!    [`Priority`] (current image > visible thumbnails > prefetch). On overflow
//!    the lowest-priority / oldest *queued* (never-started) entry is dropped by
//!    dropping its `oneshot` sender; its leader then resolves with a benign
//!    [`SchedulerError::Superseded`]. **Running jobs are never dropped.**
//! 3. **Dispatcher-granted permit** — a per-class dispatcher task owns the
//!    class's `Arc<Semaphore>`. It waits for the queue to be non-empty
//!    (`Notify`), acquires a permit (which blocks while permits are saturated,
//!    so no idle permit is held over an empty queue), pops the *highest-priority*
//!    queued job, and hands it the `OwnedSemaphorePermit` over its `oneshot`.
//!    Because the dispatcher pops to fill a permit, **priority (not FIFO)**
//!    decides who runs. The woken leader then runs the heavy work under the
//!    permit (callers run it via `spawn_blocking`).
//!
//! **No nested re-entry:** a job that already holds a permit must never call back
//! into the scheduler for another permit (would risk deadlock against the
//! full/enhance = 1 class).
//!
//! The async runtime is Tauri's (`tauri::async_runtime`, itself tokio); only
//! tokio's `sync` feature is required. `tokio-util` is intentionally absent (no
//! cancellation).

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};

use moka::future::Cache;
use tokio::sync::{oneshot, Notify, OwnedSemaphorePermit, Semaphore};

/// Per-class concurrency permits — the actual bound on peak decode memory, since
/// queued jobs hold no decode buffers.
const FULL_ENHANCE_PERMITS: usize = 1;
const DISPLAY_VIEWPORT_PERMITS: usize = 4;
const THUMB_SAMPLE_PERMITS: usize = 10;

/// Bounded priority-queue capacity per class. On overflow the lowest-priority /
/// oldest *queued* entry is evicted (its leader resolves `Superseded`). Modest by
/// design — queued work that piles up past this is stale navigation churn.
const QUEUE_CAPACITY: usize = 256;

/// Single-flight cache capacity. Coalescing/reattach hygiene only — NOT a
/// disk-cache replacement.
const SINGLE_FLIGHT_CAPACITY: u64 = 256;

/// Single-flight entry time-to-live. Must outlive a typical decode so a returning
/// navigator still joins the in-flight entry rather than starting a duplicate.
const SINGLE_FLIGHT_TTL_SECS: u64 = 60;

/// Relative scheduling priority of a decode-class job. Higher variants are served
/// first by the dispatcher. Ordering is derived from declaration order, so
/// `CurrentImage > VisibleThumbnail > Prefetch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Priority {
    /// Lowest — speculative prefetch of off-screen images/thumbnails.
    Prefetch,
    /// Visible filmstrip/gallery thumbnails that are on screen. Callers that have
    /// not yet wired a real priority (Phase 2 wrappers) default to this neutral
    /// middle priority until Phases 4/6 thread the real value.
    #[default]
    VisibleThumbnail,
    /// The image the user is actively viewing — served first.
    CurrentImage,
}

/// The concurrency class a job runs in. Each class has an independent permit
/// budget and an independent priority queue + dispatcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobClass {
    /// Heaviest, serialized work: full sensor demosaic / enhance decode and the
    /// clipboard full-RGBA expand. Permit budget = 1.
    FullEnhance,
    /// Default display / viewport-tier decodes. Permit budget =
    /// `DISPLAY_VIEWPORT_PERMITS`.
    DisplayViewport,
    /// Thumbnail and backdrop-sample generation. Permit budget =
    /// `THUMB_SAMPLE_PERMITS`.
    ThumbSample,
}

impl JobClass {
    fn index(self) -> usize {
        match self {
            JobClass::FullEnhance => 0,
            JobClass::DisplayViewport => 1,
            JobClass::ThumbSample => 2,
        }
    }

    fn permits(self) -> usize {
        match self {
            JobClass::FullEnhance => FULL_ENHANCE_PERMITS,
            JobClass::DisplayViewport => DISPLAY_VIEWPORT_PERMITS,
            JobClass::ThumbSample => THUMB_SAMPLE_PERMITS,
        }
    }

    /// Stable tag folded into the single-flight key so identical disk-cache keys
    /// in different classes do not collide.
    fn tag(self) -> char {
        match self {
            JobClass::FullEnhance => 'f',
            JobClass::DisplayViewport => 'd',
            JobClass::ThumbSample => 't',
        }
    }
}

/// Failure modes a scheduled job can surface *before* it runs. A job that
/// actually runs returns the inner work's own `Result`; these variants only
/// describe the scheduler refusing or dropping the queued request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerError {
    /// The queued (never-started) job was evicted under queue overflow because a
    /// higher-priority / newer job displaced it. Benign — the frontend ignores it
    /// via its stale-result guard. Running jobs are never superseded.
    Superseded,
}

impl fmt::Display for SchedulerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SchedulerError::Superseded => {
                write!(f, "scheduled job was superseded by higher-priority work")
            }
        }
    }
}

impl std::error::Error for SchedulerError {}

/// What [`Scheduler::run`] surfaces when a job did not produce a cached success.
/// Either the scheduler dropped the queued request before it ran ([`Self::Scheduler`]),
/// or the heavy work ran and *failed* ([`Self::Work`]). Work failures are NOT
/// cached, so the same key can be retried immediately (a transient decode error —
/// file mid-write, I/O blip — must not stick for the single-flight TTL).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError<E> {
    /// The queued leader was evicted under overflow before running.
    Scheduler(SchedulerError),
    /// The heavy work ran and returned an error. Not memoized.
    Work(E),
}

impl<E: fmt::Display> fmt::Display for RunError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RunError::Scheduler(err) => write!(f, "{err}"),
            RunError::Work(err) => write!(f, "{err}"),
        }
    }
}

impl<E: fmt::Debug + fmt::Display> std::error::Error for RunError<E> {}

/// A queued admission ticket: its scheduling key (priority, then arrival order)
/// plus the `oneshot` sender used to hand it the granted permit. Ordered so the
/// `BinaryHeap` pops the highest-priority, then oldest (lowest sequence) job.
struct QueuedJob {
    priority: Priority,
    seq: u64,
    permit_tx: oneshot::Sender<OwnedSemaphorePermit>,
}

impl PartialEq for QueuedJob {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}

impl Eq for QueuedJob {}

impl Ord for QueuedJob {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority first; on a tie the older job (smaller seq) wins, so we
        // reverse the seq comparison (BinaryHeap is a max-heap).
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for QueuedJob {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Per-class admission machinery: the bounded priority queue, the semaphore the
/// dispatcher hands out, and the `Notify` that wakes the dispatcher on enqueue.
struct ClassQueue {
    heap: Mutex<BinaryHeap<QueuedJob>>,
    semaphore: Arc<Semaphore>,
    notify: Notify,
}

impl ClassQueue {
    fn new(permits: usize) -> Self {
        Self {
            heap: Mutex::new(BinaryHeap::new()),
            semaphore: Arc::new(Semaphore::new(permits)),
            notify: Notify::new(),
        }
    }

    /// Push a job, evicting the lowest-priority / newest queued entry first when
    /// at capacity. Returns the receiver the leader awaits for its permit.
    ///
    /// Eviction strategy: when full we drop the *least useful* queued entry. We
    /// compare the incoming job against the current worst queued job; the loser
    /// is dropped (its sender drop resolves that leader as `Superseded`). This
    /// guarantees a running job is never touched (only queued senders live here)
    /// and that a higher-priority newcomer always displaces a lower-priority
    /// straggler.
    fn enqueue(&self, job: QueuedJob) {
        let mut heap = self.heap.lock().expect("scheduler heap mutex not poisoned");
        if heap.len() >= QUEUE_CAPACITY {
            // Find the current worst (lowest-priority, then newest) queued job.
            // BinaryHeap has no cheap "peek min", so drain into a Vec, drop the
            // worst of {existing-worst, newcomer}, and rebuild. QUEUE_CAPACITY is
            // small and overflow is the rare path, so the O(n) rebuild is fine.
            let mut entries: Vec<QueuedJob> = heap.drain().collect();
            entries.push(job);
            // The "worst" job is the minimum under our Ord (lowest priority, then
            // newest/highest seq). Find and remove it.
            let worst_idx = entries
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| a.cmp(b))
                .map(|(i, _)| i)
                .expect("entries is non-empty (just pushed)");
            // Dropping the removed job's sender resolves its leader as Superseded.
            entries.swap_remove(worst_idx);
            heap.extend(entries);
        } else {
            heap.push(job);
        }
        drop(heap);
        self.notify.notify_one();
    }
}

/// The decode scheduler, held in Tauri managed `State`.
///
/// Cheaply cloneable: the inner state is `Arc`-shared, so a command handler can
/// hold a `State<'_, Scheduler>` and call [`Scheduler::run`] without cloning the
/// heavy internals.
#[derive(Clone)]
pub struct Scheduler {
    inner: Arc<SchedulerInner>,
}

struct SchedulerInner {
    classes: [ClassQueue; 3],
    seq: AtomicU64,
    /// Single-flight cache keyed by `class-tag + disk-cache key`. The cached value
    /// is the *result of running the job* (cloned to every joiner). We store the
    /// joinable result as an `Arc` so cloning to many callers is cheap regardless
    /// of the inner type.
    single_flight: Cache<String, SingleFlightSlot>,
}

/// What `moka` caches per key: the shared result of the leader's run. It must be
/// `Clone` because moka clones the cached value to each awaiting caller. We box
/// the dynamic result behind an `Arc` so any `Send + Sync + 'static` result type
/// works without monomorphizing the cache per type.
type SingleFlightSlot = Arc<dyn std::any::Any + Send + Sync>;

impl Scheduler {
    /// Build the scheduler and spawn one dispatcher task per class on the Tauri
    /// async runtime. Must be called inside a tokio runtime context (it is, in
    /// `lib.rs` `setup` and in `#[tokio::test]`).
    pub fn new() -> Self {
        let inner = Arc::new(SchedulerInner {
            classes: [
                ClassQueue::new(JobClass::FullEnhance.permits()),
                ClassQueue::new(JobClass::DisplayViewport.permits()),
                ClassQueue::new(JobClass::ThumbSample.permits()),
            ],
            seq: AtomicU64::new(0),
            single_flight: Cache::builder()
                .max_capacity(SINGLE_FLIGHT_CAPACITY)
                .time_to_live(std::time::Duration::from_secs(SINGLE_FLIGHT_TTL_SECS))
                .build(),
        });

        for class in [
            JobClass::FullEnhance,
            JobClass::DisplayViewport,
            JobClass::ThumbSample,
        ] {
            let inner = Arc::clone(&inner);
            tauri::async_runtime::spawn(async move {
                dispatch_loop(inner, class).await;
            });
        }

        Self { inner }
    }

    /// Schedule `work` in `class` at `priority`, coalescing on `key`.
    ///
    /// Sequencing (single-flight → admission → permit → run):
    /// 1. If a job for `(class, key)` is already in-flight (or recently
    ///    completed within the TTL), this call *joins* it and returns the shared
    ///    result — `work` is not run, no permit is taken (single-flight).
    /// 2. Otherwise this caller is the leader: it enqueues at `priority`, awaits a
    ///    permit from the dispatcher, then runs `work` while holding the permit.
    ///    The permit is released when `work` completes.
    ///
    /// `work` is the heavy job (callers wrap blocking decode in `spawn_blocking`
    /// inside it). It must be `Send + 'static` and produce a
    /// `Result<T, E>` whose success `T` is `Send + Sync + 'static` (so it can be
    /// shared to joiners via `Arc`) and whose error `E` is `Clone + Send + Sync`.
    ///
    /// **Only successful results are memoized.** A work *failure* (`Err(E)`) is
    /// surfaced to the caller as [`RunError::Work`] and is NOT stored in the
    /// single-flight cache, so the very next request for the same key re-executes
    /// the work. This is what prevents a transient decode failure (file
    /// mid-write, I/O blip) from being stuck for the single-flight TTL.
    ///
    /// Returns `Err(RunError::Scheduler(SchedulerError::Superseded))` if this
    /// caller's *queued* leader was evicted under overflow before it ran. A
    /// request that has already started running is never superseded.
    pub async fn run<F, Fut, T, E>(
        &self,
        class: JobClass,
        priority: Priority,
        key: String,
        work: F,
    ) -> Result<Arc<T>, RunError<E>>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, E>> + Send,
        T: Send + Sync + 'static,
        E: Clone + Send + Sync + 'static,
    {
        let single_flight_key = format!("{}:{}", class.tag(), key);
        let inner = Arc::clone(&self.inner);

        // `try_get_with` runs the leader future exactly once for concurrent/
        // returning callers of the same key; followers await the same result. The
        // future returns `Result<SingleFlightSlot, Arc<RunError<E>>>`: moka caches
        // only the `Ok` variant, so neither a `Superseded` admission failure nor a
        // *work* failure is memoized — both can be retried by the next request.
        let result: Result<SingleFlightSlot, Arc<RunError<E>>> = self
            .inner
            .single_flight
            .try_get_with(single_flight_key, async move {
                let class_index = class.index();
                // Admission: enqueue and await the dispatcher-granted permit.
                let (permit_tx, permit_rx) = oneshot::channel();
                let seq = inner.seq.fetch_add(1, AtomicOrdering::Relaxed);
                inner.classes[class_index].enqueue(QueuedJob {
                    priority,
                    seq,
                    permit_tx,
                });

                // Await the permit. If the sender was dropped (queue-overflow
                // eviction), this resolves Err and the job is superseded — the
                // error is returned to `try_get_with` and NOT cached.
                let _permit = match permit_rx.await {
                    Ok(permit) => permit,
                    Err(_) => return Err(RunError::Scheduler(SchedulerError::Superseded)),
                };

                // Run the heavy work while holding the permit. The permit drops
                // when this scope ends, freeing the next `acquire_owned`. A work
                // failure is returned as `RunError::Work` so `try_get_with` does
                // NOT cache it (only the success descriptor is memoized).
                match work().await {
                    Ok(value) => Ok(Arc::new(value) as SingleFlightSlot),
                    Err(err) => Err(RunError::Work(err)),
                }
            })
            .await;

        match result {
            Ok(slot) => Ok(slot
                .downcast::<T>()
                .expect("single-flight slot type matches the requested key's job type")),
            Err(err) => Err((*err).clone()),
        }
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-class dispatcher: the only place permits are acquired. It owns the order
/// in which queued jobs run (priority, not FIFO), and guarantees exactly one
/// permit per running job.
async fn dispatch_loop(inner: Arc<SchedulerInner>, class: JobClass) {
    let queue = &inner.classes[class.index()];
    loop {
        // Wait until there is at least one queued job.
        //
        // Lost-wakeup safety (why this conditional `notified()` is correct):
        //  - Every `enqueue` pushes under the heap lock and then calls
        //    `notify_one()`. `Notify` stores at most one permit.
        //  - If an enqueue's `notify_one()` races between this `is_empty()` check
        //    and the `notified().await`, the stored permit makes `notified()`
        //    return immediately — the wakeup is not lost.
        //  - Coalesced notifications (many enqueues, one stored permit) are NOT a
        //    problem: this loop drains by RE-CHECKING `is_empty()` every iteration,
        //    not by counting notifications. While the heap is non-empty we skip the
        //    park entirely and go straight to acquire+pop, so every queued job is
        //    eventually popped regardless of how many notifications coalesced.
        //  - The single stored permit can at most cause one spurious wake right
        //    after the heap empties (the empty-pop `continue` path below re-parks),
        //    which is harmless. Verified by `dispatcher_drains_bursty_enqueues_*`.
        if queue
            .heap
            .lock()
            .expect("scheduler heap mutex not poisoned")
            .is_empty()
        {
            queue.notify.notified().await;
        }

        // Acquire a permit. This blocks while the class is saturated, so we never
        // hold an idle permit over an empty queue. `acquire_owned` only fails if
        // the semaphore is closed, which never happens (we never close it).
        let permit = Arc::clone(&queue.semaphore)
            .acquire_owned()
            .await
            .expect("scheduler semaphore is never closed");

        // Pop the highest-priority queued job. Edge case: the heap may have been
        // emptied by eviction between the Notify and here — if so, drop the permit
        // and loop back to waiting (never unwrap an empty pop, never busy-spin).
        let job = match queue
            .heap
            .lock()
            .expect("scheduler heap mutex not poisoned")
            .pop()
        {
            Some(job) => job,
            None => {
                drop(permit);
                continue;
            }
        };

        // Hand the permit to the leader over its oneshot. If the receiver was
        // already dropped (leader gave up), the permit drops here and frees the
        // next acquire — benign.
        if job.permit_tx.send(permit).is_err() {
            continue;
        }
    }
}

#[doc(hidden)]
pub mod __test_support {
    //! Test-only constructors exposing the private constants and ordering so the
    //! integration test can assert them without a real decode.
    use super::*;

    pub const fn full_enhance_permits() -> usize {
        FULL_ENHANCE_PERMITS
    }
    pub const fn display_viewport_permits() -> usize {
        DISPLAY_VIEWPORT_PERMITS
    }
    pub const fn thumb_sample_permits() -> usize {
        THUMB_SAMPLE_PERMITS
    }
    pub const fn queue_capacity() -> usize {
        QUEUE_CAPACITY
    }
}
