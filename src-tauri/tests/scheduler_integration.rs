//! Decode scheduler behaviour (Phase 2): per-class permit limits, priority
//! ordering, bounded-queue drop-stale eviction, and single-flight coalescing /
//! reattach. Each test drives the scheduler with an instrumented closure (no real
//! decode) so the concurrency invariants are observable deterministically.
//!
//! All tests run on a multi-threaded tokio runtime (`flavor = "multi_thread"`) so
//! the per-class dispatcher tasks make progress concurrently with the test body.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use imageareo_lib::scheduler::{JobClass, Priority, RunError, Scheduler, SchedulerError};
use imageareo_lib::scheduler::__test_support as ts;
use tokio::sync::Notify;
use tokio::time::{sleep, timeout};

/// A small shared counter for "how many jobs are running concurrently right now"
/// and "what was the peak". Used to assert permit limits.
#[derive(Default)]
struct ConcurrencyTracker {
    current: AtomicUsize,
    peak: AtomicUsize,
    total: AtomicUsize,
}

impl ConcurrencyTracker {
    fn enter(&self) {
        self.total.fetch_add(1, Ordering::SeqCst);
        let now = self.current.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
    }
    fn leave(&self) {
        self.current.fetch_sub(1, Ordering::SeqCst);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn never_exceeds_per_class_permit_counts() {
    let scheduler = Scheduler::new();

    for (class, limit) in [
        (JobClass::FullEnhance, ts::full_enhance_permits()),
        (JobClass::DisplayViewport, ts::display_viewport_permits()),
        (JobClass::ThumbSample, ts::thumb_sample_permits()),
    ] {
        let tracker = Arc::new(ConcurrencyTracker::default());
        let mut handles = Vec::new();
        // Submit many *distinct* keys so single-flight does not collapse them.
        for i in 0..20 {
            let scheduler = scheduler.clone();
            let tracker = Arc::clone(&tracker);
            let key = format!("permit-{class:?}-{i}");
            handles.push(tokio::spawn(async move {
                scheduler
                    .run(class, Priority::CurrentImage, key, move || async move {
                        tracker.enter();
                        // Hold the permit briefly so concurrent peak is observable.
                        sleep(Duration::from_millis(20)).await;
                        tracker.leave();
                        Ok::<(), ()>(())
                    })
                    .await
                    .map(|arc| *arc)
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }
        assert_eq!(
            tracker.total.load(Ordering::SeqCst),
            20,
            "{class:?}: all distinct jobs should run"
        );
        assert!(
            tracker.peak.load(Ordering::SeqCst) <= limit,
            "{class:?}: peak concurrency {} exceeded permit limit {limit}",
            tracker.peak.load(Ordering::SeqCst)
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn identical_concurrent_requests_execute_once() {
    let scheduler = Scheduler::new();
    let executions = Arc::new(AtomicUsize::new(0));
    // A barrier blocks the leader's decode so all followers arrive while it is
    // still in-flight, exercising concurrent (not post-completion) coalescing.
    let gate = Arc::new(Notify::new());

    let mut handles = Vec::new();
    for _ in 0..10 {
        let scheduler = scheduler.clone();
        let executions = Arc::clone(&executions);
        let gate = Arc::clone(&gate);
        handles.push(tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::DisplayViewport,
                    Priority::CurrentImage,
                    "same-key".to_string(),
                    move || async move {
                        executions.fetch_add(1, Ordering::SeqCst);
                        gate.notified().await;
                        Ok::<u32, ()>(42_u32)
                    },
                )
                .await
                .map(|arc| *arc)
        }));
    }

    // Give every caller a chance to join the in-flight leader, then release it.
    sleep(Duration::from_millis(50)).await;
    gate.notify_waiters();

    let mut results = Vec::new();
    for h in handles {
        results.push(h.await.unwrap().unwrap());
    }

    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "underlying work must execute exactly once for identical concurrent keys"
    );
    assert!(
        results.iter().all(|&v| v == 42),
        "all callers receive the cloned leader result"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn returning_request_reattaches_to_in_flight_job() {
    let scheduler = Scheduler::new();
    let executions = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(Notify::new());

    // Leader starts and blocks mid-decode.
    let leader = {
        let scheduler = scheduler.clone();
        let executions = Arc::clone(&executions);
        let release = Arc::clone(&release);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "reattach-key".to_string(),
                    move || async move {
                        executions.fetch_add(1, Ordering::SeqCst);
                        release.notified().await;
                        Ok::<u32, ()>(7_u32)
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };

    // Let the leader start and block on `release`.
    sleep(Duration::from_millis(40)).await;
    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "leader should be in-flight"
    );

    // A later request for the same key arrives while the leader is still running:
    // it must join, not start a second decode.
    let follower = {
        let scheduler = scheduler.clone();
        let executions = Arc::clone(&executions);
        tokio::spawn(async move {
            let r = scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "reattach-key".to_string(),
                    move || async move {
                        // Must never run — would mean a duplicate decode.
                        executions.fetch_add(100, Ordering::SeqCst);
                        Ok::<u32, ()>(999_u32)
                    },
                )
                .await
                .map(|arc| *arc);
            r
        })
    };

    sleep(Duration::from_millis(40)).await;
    release.notify_waiters();

    assert_eq!(leader.await.unwrap().unwrap(), 7);
    assert_eq!(follower.await.unwrap().unwrap(), 7);
    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "the in-flight job must be re-joined, not re-decoded"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dispatcher_serves_highest_priority_first() {
    let scheduler = Scheduler::new();
    // FullEnhance has exactly one permit. Occupy it with a blocker so subsequent
    // jobs must queue, then enqueue low- then high-priority jobs and assert the
    // high-priority one runs first when the permit frees.
    let blocker_release = Arc::new(Notify::new());
    let order = Arc::new(tokio::sync::Mutex::new(Vec::<&'static str>::new()));

    let blocker = {
        let scheduler = scheduler.clone();
        let blocker_release = Arc::clone(&blocker_release);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "blocker".to_string(),
                    move || async move {
                        blocker_release.notified().await;
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };

    // Ensure the blocker holds the only permit.
    sleep(Duration::from_millis(40)).await;

    // Enqueue a low-priority job first, then a high-priority job. Both are queued
    // behind the held permit.
    let low = {
        let scheduler = scheduler.clone();
        let order = Arc::clone(&order);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::Prefetch,
                    "low".to_string(),
                    move || async move {
                        order.lock().await.push("low");
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(10)).await;
    let high = {
        let scheduler = scheduler.clone();
        let order = Arc::clone(&order);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "high".to_string(),
                    move || async move {
                        order.lock().await.push("high");
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };

    // Both are queued now; free the permit.
    sleep(Duration::from_millis(20)).await;
    blocker_release.notify_waiters();

    blocker.await.unwrap().unwrap();
    high.await.unwrap().unwrap();
    low.await.unwrap().unwrap();

    let order = order.lock().await;
    assert_eq!(
        order.as_slice(),
        ["high", "low"],
        "dispatcher must serve the higher-priority queued job first (priority, not FIFO)"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queue_overflow_drops_lowest_priority_queued_job() {
    let scheduler = Scheduler::new();
    let cap = ts::queue_capacity();
    // Occupy the single FullEnhance permit so everything else queues.
    let blocker_release = Arc::new(Notify::new());
    let blocker = {
        let scheduler = scheduler.clone();
        let blocker_release = Arc::clone(&blocker_release);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "ovf-blocker".to_string(),
                    move || async move {
                        blocker_release.notified().await;
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(40)).await;

    // A lone low-priority job we expect to be evicted when the queue overflows.
    let victim = {
        let scheduler = scheduler.clone();
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::Prefetch,
                    "victim".to_string(),
                    move || async move { Ok::<u32, ()>(1_u32) },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(20)).await;

    // Now flood the queue with higher-priority jobs past capacity so the victim is
    // displaced. Each gets a distinct key.
    let mut floods = Vec::new();
    for i in 0..(cap + 5) {
        let scheduler = scheduler.clone();
        let key = format!("flood-{i}");
        floods.push(tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    key,
                    move || async move { Ok::<u32, ()>(0_u32) },
                )
                .await
                .map(|arc| *arc)
        }));
    }

    // The victim's queued leader should resolve Superseded (sender dropped on
    // eviction) — observable before we ever release the blocker.
    let victim_result = timeout(Duration::from_secs(2), victim)
        .await
        .expect("victim should resolve without releasing the blocker")
        .unwrap();
    assert_eq!(
        victim_result,
        Err(RunError::Scheduler(SchedulerError::Superseded)),
        "lowest-priority queued job should be dropped under overflow"
    );

    // The running blocker is never dropped — release it and confirm it completes.
    blocker_release.notify_waiters();
    blocker
        .await
        .unwrap()
        .expect("running job is never superseded");

    // Drain the floods so the runtime has no dangling tasks.
    for f in floods {
        let _ = f.await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn distinct_classes_run_independently() {
    // A saturated FullEnhance class must not block ThumbSample work — classes have
    // independent permits, queues, and dispatchers.
    let scheduler = Scheduler::new();
    let release = Arc::new(Notify::new());

    let heavy = {
        let scheduler = scheduler.clone();
        let release = Arc::clone(&release);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "heavy".to_string(),
                    move || async move {
                        release.notified().await;
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(30)).await;

    // ThumbSample work should complete even though FullEnhance is saturated.
    let thumb = scheduler
        .run(
            JobClass::ThumbSample,
            Priority::VisibleThumbnail,
            "thumb".to_string(),
            move || async move { Ok::<u32, ()>(5_u32) },
        )
        .await
        .map(|arc| *arc);
    assert_eq!(thumb, Ok(5), "thumb class is independent of saturated full class");

    release.notify_waiters();
    heavy.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn superseded_key_can_be_retried() {
    // A superseded leader must NOT be cached, so a later request for the same key
    // can run fresh. We force a supersede via overflow, then re-request the key.
    let scheduler = Scheduler::new();
    let cap = ts::queue_capacity();
    let blocker_release = Arc::new(Notify::new());
    let blocker = {
        let scheduler = scheduler.clone();
        let blocker_release = Arc::clone(&blocker_release);
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    "retry-blocker".to_string(),
                    move || async move {
                        blocker_release.notified().await;
                        Ok::<(), ()>(())
                    },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(30)).await;

    let victim = {
        let scheduler = scheduler.clone();
        tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::Prefetch,
                    "retry-key".to_string(),
                    move || async move { Ok::<u32, ()>(11_u32) },
                )
                .await
                .map(|arc| *arc)
        })
    };
    sleep(Duration::from_millis(20)).await;

    let mut floods = Vec::new();
    for i in 0..(cap + 5) {
        let scheduler = scheduler.clone();
        let key = format!("retry-flood-{i}");
        floods.push(tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::FullEnhance,
                    Priority::CurrentImage,
                    key,
                    move || async move { Ok::<u32, ()>(0_u32) },
                )
                .await
                .map(|arc| *arc)
        }));
    }

    assert_eq!(
        timeout(Duration::from_secs(2), victim)
            .await
            .unwrap()
            .unwrap(),
        Err(RunError::Scheduler(SchedulerError::Superseded))
    );

    blocker_release.notify_waiters();
    blocker.await.unwrap().unwrap();
    for f in floods {
        let _ = f.await.unwrap();
    }

    // Re-request the superseded key — it must run fresh now, not return the cached
    // supersede error.
    let executed = Arc::new(AtomicUsize::new(0));
    let executed_clone = Arc::clone(&executed);
    let retried = scheduler
        .run(
            JobClass::FullEnhance,
            Priority::CurrentImage,
            "retry-key".to_string(),
            move || async move {
                executed_clone.fetch_add(1, Ordering::SeqCst);
                Ok::<u32, ()>(11_u32)
            },
        )
        .await
        .map(|arc| *arc);
    assert_eq!(retried, Ok(11));
    assert_eq!(executed.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn work_error_is_not_cached_but_success_is_coalesced() {
    // FIX 2: a single-flight slot must memoize only successful work. A *failed*
    // decode (transient: file mid-write, I/O blip) must NOT be cached for the TTL,
    // so the next request for the same key re-executes; a successful key must
    // still be coalesced/cached so it executes exactly once.
    let scheduler = Scheduler::new();

    // 1) A key whose first execution fails must re-execute on the next request.
    let err_runs = Arc::new(AtomicUsize::new(0));
    for _ in 0..3 {
        let err_runs = Arc::clone(&err_runs);
        let result = scheduler
            .run(
                JobClass::DisplayViewport,
                Priority::CurrentImage,
                "transient-failure".to_string(),
                move || async move {
                    err_runs.fetch_add(1, Ordering::SeqCst);
                    Err::<u32, &'static str>("transient I/O error")
                },
            )
            .await
            .map(|arc| *arc);
        assert_eq!(result, Err(RunError::Work("transient I/O error")));
    }
    assert_eq!(
        err_runs.load(Ordering::SeqCst),
        3,
        "a failing key must be re-executed every time, never served from cache"
    );

    // 2) A successful key is cached: repeated sequential requests run the work
    //    exactly once.
    let ok_runs = Arc::new(AtomicUsize::new(0));
    for _ in 0..3 {
        let ok_runs = Arc::clone(&ok_runs);
        let result = scheduler
            .run(
                JobClass::DisplayViewport,
                Priority::CurrentImage,
                "stable-success".to_string(),
                move || async move {
                    ok_runs.fetch_add(1, Ordering::SeqCst);
                    Ok::<u32, &'static str>(7_u32)
                },
            )
            .await
            .map(|arc| *arc);
        assert_eq!(result, Ok(7));
    }
    assert_eq!(
        ok_runs.load(Ordering::SeqCst),
        1,
        "a successful key must be memoized and run exactly once"
    );

    // 3) A key that fails first, then is re-requested and succeeds: the success is
    //    applied (not masked by the earlier cached error) and runs fresh.
    let mixed_runs = Arc::new(AtomicUsize::new(0));
    let first = {
        let mixed_runs = Arc::clone(&mixed_runs);
        scheduler
            .run(
                JobClass::DisplayViewport,
                Priority::CurrentImage,
                "fail-then-succeed".to_string(),
                move || async move {
                    mixed_runs.fetch_add(1, Ordering::SeqCst);
                    Err::<u32, &'static str>("first attempt blip")
                },
            )
            .await
            .map(|arc| *arc)
    };
    assert_eq!(first, Err(RunError::Work("first attempt blip")));

    let second = {
        let mixed_runs = Arc::clone(&mixed_runs);
        scheduler
            .run(
                JobClass::DisplayViewport,
                Priority::CurrentImage,
                "fail-then-succeed".to_string(),
                move || async move {
                    mixed_runs.fetch_add(1, Ordering::SeqCst);
                    Ok::<u32, &'static str>(99_u32)
                },
            )
            .await
            .map(|arc| *arc)
    };
    assert_eq!(second, Ok(99), "retry after a transient failure must succeed");
    assert_eq!(mixed_runs.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dispatcher_drains_bursty_enqueues_without_losing_wakeups() {
    // FIX 3 (regression guard): a stress test for the dispatcher wait-loop. We use
    // the single-permit FullEnhance class so jobs must serialize through the one
    // permit, and bursty-enqueue many distinct keys across several rounds. Every
    // enqueued, non-evicted job must eventually run — a lost wakeup would stall the
    // dispatcher and time out this test. Repeated over many iterations to shake out
    // any rare scheduling race.
    for iteration in 0..50 {
        let scheduler = Scheduler::new();
        let completed = Arc::new(AtomicUsize::new(0));
        const JOBS: usize = 40;
        let mut handles = Vec::new();
        for i in 0..JOBS {
            let scheduler = scheduler.clone();
            let completed = Arc::clone(&completed);
            let key = format!("burst-{iteration}-{i}");
            handles.push(tokio::spawn(async move {
                scheduler
                    .run(JobClass::FullEnhance, Priority::CurrentImage, key, move || {
                        async move {
                            completed.fetch_add(1, Ordering::SeqCst);
                            Ok::<(), ()>(())
                        }
                    })
                    .await
                    .map(|arc| *arc)
            }));
            // Occasionally yield so enqueues interleave with the dispatcher draining
            // the heap (and emptying it between bursts), exercising the empty-heap
            // re-park path.
            if i % 7 == 0 {
                tokio::task::yield_now().await;
            }
        }

        for h in handles {
            timeout(Duration::from_secs(5), h)
                .await
                .expect("every enqueued job must eventually run (no lost wakeup / stall)")
                .unwrap()
                .unwrap();
        }
        assert_eq!(
            completed.load(Ordering::SeqCst),
            JOBS,
            "iteration {iteration}: all bursty single-permit jobs must complete"
        );
    }
}
