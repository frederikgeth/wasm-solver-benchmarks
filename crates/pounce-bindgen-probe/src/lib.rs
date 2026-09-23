//! Feasibility probe: call the same POUNCE solver through wasm-bindgen on
//! `wasm32-unknown-unknown`, the target used by Tellegen's browser package.
//!
//! The frozen NL input is intentional: this isolates the ABI/target question
//! from a future PowerIO-to-POUNCE expression-model compiler.

use wasm_bindgen::prelude::wasm_bindgen;

fn take_payload(pointer: *mut u8) -> String {
    if pointer.is_null() {
        return r#"{"error":"POUNCE returned a null payload"}"#.to_owned();
    }
    // SAFETY: POUNCE's ABI returns a live allocation with a u32 byte count
    // followed by that many UTF-8 bytes. We copy before releasing it.
    let result = unsafe {
        let len = std::ptr::read_unaligned(pointer.cast::<u32>()) as usize;
        let bytes = std::slice::from_raw_parts(pointer.add(4), len);
        String::from_utf8_lossy(bytes).into_owned()
    };
    // SAFETY: this is the same live payload just returned by POUNCE.
    unsafe { pounce_wasm::pounce_free_payload(pointer) };
    result
}

#[wasm_bindgen]
pub fn load_nl(nl: &str, col: &str, row: &str) -> String {
    // SAFETY: all three Rust string borrows remain alive throughout the call.
    let pointer = unsafe {
        pounce_wasm::pounce_load(
            nl.as_ptr(),
            nl.len(),
            col.as_ptr(),
            col.len(),
            row.as_ptr(),
            row.len(),
        )
    };
    take_payload(pointer)
}

#[wasm_bindgen]
pub fn solve(options: &str) -> String {
    // SAFETY: the options borrow remains alive throughout the call.
    let pointer = unsafe { pounce_wasm::pounce_solve(options.as_ptr(), options.len()) };
    take_payload(pointer)
}

#[wasm_bindgen]
pub fn solution_csv() -> String {
    take_payload(pounce_wasm::pounce_solution_csv())
}
