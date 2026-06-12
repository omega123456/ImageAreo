use std::env;

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use super::{
    progid_for, registry_key_paths, validate_extensions, AssociationError, ExtAssociation,
    ASSOCIABLE_EXTENSIONS, WINDOWS_APPLICATION_NAME, WINDOWS_CAPABILITIES_PATH,
    WINDOWS_CLASSES_PATH, WINDOWS_REGISTERED_APPLICATIONS_PATH,
};

const DEFAULT_APPS_URL: &str = "ms-settings:defaultapps";

pub fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut associations = Vec::with_capacity(ASSOCIABLE_EXTENSIONS.len());

    for ext in ASSOCIABLE_EXTENSIONS {
        let paths = registry_key_paths(ext);
        let is_default = hkcu
            .open_subkey(&paths.user_choice_key)
            .ok()
            .and_then(|key| key.get_value::<String, _>("ProgId").ok())
            .is_some_and(|progid| progid == paths.progid);

        associations.push(ExtAssociation {
            ext: (*ext).to_string(),
            is_default,
        });
    }

    Ok(associations)
}

pub fn set_default_associations(exts: &[String]) -> Result<(), AssociationError> {
    let validated = validate_extensions(exts.iter())?;
    register_file_associations(&validated)?;
    tauri_plugin_opener::open_url(DEFAULT_APPS_URL, None::<&str>).map_err(|err| {
        AssociationError::register(format!(
            "failed to open Windows Default Apps settings ({DEFAULT_APPS_URL}): {err}"
        ))
    })?;
    Ok(())
}

fn register_file_associations(exts: &[String]) -> Result<(), AssociationError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (classes, _) = hkcu
        .create_subkey(WINDOWS_CLASSES_PATH)
        .map_err(|err| AssociationError::register(format!("failed to open classes registry hive: {err}")))?;
    let exe_path = env::current_exe()
        .map_err(|err| AssociationError::register(format!("failed to resolve current executable: {err}")))?;
    let command = format!("\"{}\" \"%1\"", exe_path.display());

    for ext in exts {
        let normalized = ext.as_str();
        let progid = progid_for(normalized);

        let (command_key, _) = classes.create_subkey(format!(r"{progid}\shell\open\command")).map_err(
            |err| {
                AssociationError::register(format!(
                    "failed to create ProgID command key for .{normalized}: {err}"
                ))
            },
        )?;
        command_key.set_value("", &command).map_err(|err| {
            AssociationError::register(format!(
                "failed to set open command for .{normalized}: {err}"
            ))
        })?;

        let (open_with_key, _) = classes
            .create_subkey(format!(r".{normalized}\OpenWithProgids"))
            .map_err(|err| {
                AssociationError::register(format!(
                    "failed to create OpenWithProgids for .{normalized}: {err}"
                ))
            })?;
        open_with_key.set_value(&progid, &"").map_err(|err| {
            AssociationError::register(format!(
                "failed to register ProgID {progid} for .{normalized}: {err}"
            ))
        })?;
    }

    let (capabilities, _) = hkcu
        .create_subkey(WINDOWS_CAPABILITIES_PATH)
        .map_err(|err| AssociationError::register(format!("failed to create capabilities key: {err}")))?;
    capabilities
        .set_value("ApplicationName", &WINDOWS_APPLICATION_NAME)
        .map_err(|err| {
            AssociationError::register(format!("failed to write ApplicationName capability: {err}"))
        })?;
    capabilities
        .set_value(
            "ApplicationDescription",
            &"Lightweight, fast, modern cross-platform desktop image viewer.",
        )
        .map_err(|err| {
            AssociationError::register(format!(
                "failed to write ApplicationDescription capability: {err}"
            ))
        })?;

    let (file_associations, _) = capabilities
        .create_subkey("FileAssociations")
        .map_err(|err| AssociationError::register(format!("failed to create FileAssociations key: {err}")))?;
    for ext in exts {
        let normalized = ext.as_str();
        file_associations
            .set_value(format!(".{normalized}"), &progid_for(normalized))
            .map_err(|err| {
                AssociationError::register(format!(
                    "failed to register capabilities mapping for .{normalized}: {err}"
                ))
            })?;
    }

    let (registered_apps, _) = hkcu.create_subkey(WINDOWS_REGISTERED_APPLICATIONS_PATH).map_err(
        |err| AssociationError::register(format!("failed to open RegisteredApplications key: {err}")),
    )?;
    registered_apps
        .set_value(WINDOWS_APPLICATION_NAME, &WINDOWS_CAPABILITIES_PATH)
        .map_err(|err| {
            AssociationError::register(format!(
                "failed to register {} in RegisteredApplications: {err}",
                WINDOWS_APPLICATION_NAME
            ))
        })?;

    Ok(())
}
