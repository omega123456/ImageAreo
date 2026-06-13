use core_foundation::base::{OSStatus, TCFType};
use core_foundation::string::CFString;
use core_foundation_sys::string::CFStringRef;

use super::{
    uti_for, validate_extensions, AssociationError, ExtAssociation, ASSOCIABLE_EXTENSIONS,
    BUNDLE_ID,
};

const KLS_ROLES_VIEWER: u32 = 0x0000_0002;

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    static kUTTagClassFilenameExtension: CFStringRef;

    fn UTTypeCreatePreferredIdentifierForTag(
        in_tag_class: CFStringRef,
        in_tag: CFStringRef,
        in_conforming_to_uti: CFStringRef,
    ) -> CFStringRef;

    fn LSCopyDefaultRoleHandlerForContentType(
        in_content_type: CFStringRef,
        in_role: u32,
    ) -> CFStringRef;

    fn LSSetDefaultRoleHandlerForContentType(
        in_content_type: CFStringRef,
        in_role: u32,
        in_handler_bundle_id: CFStringRef,
    ) -> OSStatus;
}

pub fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    let mut associations = Vec::with_capacity(ASSOCIABLE_EXTENSIONS.len());

    for ext in ASSOCIABLE_EXTENSIONS {
        let uti = preferred_uti(ext)?;
        let is_default =
            current_handler_bundle_id(&uti)?.is_some_and(|bundle_id| bundle_id == BUNDLE_ID);

        associations.push(ExtAssociation {
            ext: (*ext).to_string(),
            is_default,
        });
    }

    Ok(associations)
}

pub fn set_default_associations(exts: &[String]) -> Result<(), AssociationError> {
    let validated = validate_extensions(exts.iter())?;
    let bundle_id = CFString::new(BUNDLE_ID);

    for ext in validated {
        let uti = preferred_uti(&ext)?;
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                uti.as_concrete_TypeRef(),
                KLS_ROLES_VIEWER,
                bundle_id.as_concrete_TypeRef(),
            )
        };

        if status != 0 {
            return Err(AssociationError::register(format!(
                "failed to set ImageAreo as the default viewer for .{ext} (Launch Services status {status})"
            )));
        }
    }

    Ok(())
}

fn preferred_uti(ext: &str) -> Result<CFString, AssociationError> {
    if let Some(uti) = uti_for(ext) {
        return Ok(CFString::new(uti));
    }

    let ext_cf = CFString::new(ext);
    let uti_ref = unsafe {
        UTTypeCreatePreferredIdentifierForTag(
            kUTTagClassFilenameExtension,
            ext_cf.as_concrete_TypeRef(),
            std::ptr::null(),
        )
    };

    if uti_ref.is_null() {
        return Err(AssociationError::query(format!(
            "failed to resolve a content type for .{ext}"
        )));
    }

    Ok(unsafe { CFString::wrap_under_create_rule(uti_ref) })
}

fn current_handler_bundle_id(uti: &CFString) -> Result<Option<String>, AssociationError> {
    let handler_ref = unsafe {
        LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), KLS_ROLES_VIEWER)
    };

    if handler_ref.is_null() {
        return Ok(None);
    }

    let bundle_id = unsafe { CFString::wrap_under_create_rule(handler_ref) };
    Ok(Some(bundle_id.to_string()))
}
