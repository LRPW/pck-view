#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app;

fn main() {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
        }
        // Keep the shell identity shared with native-gfx, before creating windows.
        let app_id: Vec<u16> = "ru.lordralinc.pwforge\0".encode_utf16().collect();
        let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
        if result < 0 {
            eprintln!("Could not set AppUserModelID: 0x{:08X}", result as u32);
        }
    }
    app::run();
}
