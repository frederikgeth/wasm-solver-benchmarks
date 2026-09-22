//! Stable benchmark-local export names for POUNCE's upstream browser ABI.

#[unsafe(no_mangle)]
pub extern "C" fn acopf_pounce_alloc(len: usize) -> *mut u8 {
    pounce_wasm::pounce_alloc(len)
}

/// # Safety
/// `ptr` and `len` must identify a live allocation returned by
/// [`acopf_pounce_alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_pounce_dealloc(ptr: *mut u8, len: usize) {
    unsafe { pounce_wasm::pounce_dealloc(ptr, len) }
}

/// # Safety
/// `ptr` must identify a live payload returned by another exported function.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_pounce_free_payload(ptr: *mut u8) {
    unsafe { pounce_wasm::pounce_free_payload(ptr) }
}

/// # Safety
/// Each non-null pointer and length must identify readable UTF-8 bytes for the
/// duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_pounce_load(
    nl_ptr: *const u8,
    nl_len: usize,
    col_ptr: *const u8,
    col_len: usize,
    row_ptr: *const u8,
    row_len: usize,
) -> *mut u8 {
    unsafe { pounce_wasm::pounce_load(nl_ptr, nl_len, col_ptr, col_len, row_ptr, row_len) }
}

/// # Safety
/// A non-null pointer and length must identify readable UTF-8 option text for
/// the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_pounce_solve(options_ptr: *const u8, options_len: usize) -> *mut u8 {
    unsafe { pounce_wasm::pounce_solve(options_ptr, options_len) }
}
