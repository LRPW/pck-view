fn main() {
    #[cfg(windows)]
    stage_native_runtime();
    tauri_build::build();
}

#[cfg(windows)]
fn stage_native_runtime() {
    use std::{env, fs, path::PathBuf};

    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtimes/native-gfx");
    println!("cargo:rerun-if-changed={}", runtime.display());
    if !runtime.is_dir() {
        return;
    }

    // Cargo places OUT_DIR at <profile>/build/<package-hash>/out.
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let profile = out.ancestors().nth(3).expect("Cargo profile directory");
    for name in [
        "native-gfx.exe", "ImmWrapper.dll", "ifc22.dll", "zlibwapi.dll",
        "msvcp140.dll", "vcruntime140.dll", "d3dx9_43.dll",
    ] {
        let source = runtime.join(name);
        let target = profile.join(name);
        println!("cargo:rerun-if-changed={}", target.display());
        if target.is_file() && fs::read(&target).ok() == fs::read(&source).ok() {
            continue;
        }
        fs::copy(&source, &target)
            .unwrap_or_else(|error| panic!("Could not stage {}: {error}", target.display()));
    }
}
