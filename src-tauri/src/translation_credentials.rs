use super::Result;

#[tauri::command]
pub fn ide_translation_key_load(provider: String, endpoint: String) -> Result<Option<String>> {
    platform::load(&target(&provider, &endpoint)?)
}

#[tauri::command]
pub fn ide_translation_key_store(
    provider: String,
    endpoint: String,
    key: Option<String>,
) -> Result<()> {
    platform::store(&target(&provider, &endpoint)?, key.as_deref())
}

fn target(provider: &str, endpoint: &str) -> Result<String> {
    if !matches!(provider, "deepl" | "yandex" | "ollama" | "compatible") {
        return Err("Неизвестный провайдер перевода".into());
    }
    let url = super::translation::provider_url(provider, endpoint)?;
    if url.len() > 2048 || url.chars().any(char::is_control) {
        return Err("Некорректный адрес сервера перевода".into());
    }
    // Credential Manager compares target names case-insensitively. URL paths can differ by case.
    let encoded: String = url.bytes().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("PW Forge/Translation/{provider}/{encoded}"))
}

#[cfg(windows)]
mod platform {
    use super::Result;
    use std::{ffi::c_void, io, ptr, slice};

    const GENERIC: u32 = 1;
    const LOCAL_MACHINE: u32 = 2;
    const NOT_FOUND: i32 = 1168;
    const MAX_BLOB: usize = 2560;

    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *const u16,
        comment: *const u16,
        last_written: [u32; 2],
        blob_size: u32,
        blob: *const u8,
        persist: u32,
        attribute_count: u32,
        attributes: *const c_void,
        target_alias: *const u16,
        username: *const u16,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn CredReadW(target: *const u16, kind: u32, flags: u32, value: *mut *mut Credential)
            -> i32;
        fn CredWriteW(value: *const Credential, flags: u32) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(value: *mut c_void);
    }

    pub fn load(target: &str) -> Result<Option<String>> {
        let name: Vec<u16> = target.encode_utf16().chain([0]).collect();
        let mut value = ptr::null_mut();
        // The returned blob belongs to the allocation released by CredFree.
        unsafe {
            if CredReadW(name.as_ptr(), GENERIC, 0, &mut value) == 0 {
                let error = io::Error::last_os_error();
                return if error.raw_os_error() == Some(NOT_FOUND) {
                    Ok(None)
                } else {
                    Err(format!("Диспетчер учётных данных Windows: {error}"))
                };
            }
            let credential = &*value;
            let size = credential.blob_size as usize;
            let result = if size == 0 {
                Ok(None)
            } else if size > MAX_BLOB || credential.blob.is_null() {
                Err("Некорректная запись ключа API".into())
            } else {
                String::from_utf8(slice::from_raw_parts(credential.blob, size).to_vec())
                    .map(Some)
                    .map_err(|_| "Некорректная кодировка ключа API".into())
            };
            CredFree(value.cast());
            result
        }
    }

    pub fn store(target: &str, key: Option<&str>) -> Result<()> {
        let name: Vec<u16> = target.encode_utf16().chain([0]).collect();
        if let Some(key) = key.filter(|key| !key.is_empty()) {
            if key.len() > MAX_BLOB || key.chars().any(char::is_control) {
                return Err("Некорректный ключ API".into());
            }
            let value = Credential {
                flags: 0,
                kind: GENERIC,
                target: name.as_ptr(),
                comment: ptr::null(),
                last_written: [0; 2],
                blob_size: key.len() as u32,
                blob: key.as_ptr(),
                persist: LOCAL_MACHINE,
                attribute_count: 0,
                attributes: ptr::null(),
                target_alias: ptr::null(),
                username: ptr::null(),
            };
            // The name and key buffers stay alive for the duration of the call.
            if unsafe { CredWriteW(&value, 0) } != 0 {
                return Ok(());
            }
        } else {
            if unsafe { CredDeleteW(name.as_ptr(), GENERIC, 0) } != 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(NOT_FOUND) {
                Ok(())
            } else {
                Err(format!("Диспетчер учётных данных Windows: {error}"))
            };
        }
        Err(format!(
            "Диспетчер учётных данных Windows: {}",
            io::Error::last_os_error()
        ))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Result;

    pub fn load(_: &str) -> Result<Option<String>> {
        Ok(None)
    }

    pub fn store(_: &str, key: Option<&str>) -> Result<()> {
        if key.is_some() {
            return Err("Сохранение ключей доступно в Windows".into());
        }
        Ok(())
    }
}
