//! Minimal raw WebAssembly ABI for [`acopf_nl_evaluator::NlEvaluator`].
//!
//! A browser worker owns one module instance and one loaded model. Numeric
//! arrays stay binary across the boundary; the JavaScript adapter copies them
//! between this module's memory and ipopt-wasm's separate Emscripten memory.

use std::alloc::{Layout, alloc, dealloc};
use std::cell::RefCell;
use std::panic::{AssertUnwindSafe, catch_unwind};

use acopf_nl_evaluator::NlEvaluator;

const ALIGNMENT: usize = align_of::<f64>();

thread_local! {
    static EVALUATOR: RefCell<Option<NlEvaluator>> = const { RefCell::new(None) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn layout(size: usize) -> Option<Layout> {
    Layout::from_size_align(size, ALIGNMENT).ok()
}

fn set_error(error: impl Into<String>) {
    LAST_ERROR.with(|slot| *slot.borrow_mut() = error.into());
}

fn clear_error() {
    LAST_ERROR.with(|slot| slot.borrow_mut().clear());
}

fn run(operation: impl FnOnce() -> Result<(), String>) -> i32 {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(())) => {
            clear_error();
            0
        }
        Ok(Err(error)) => {
            set_error(error);
            1
        }
        Err(_) => {
            set_error("NL evaluator panicked; discard this worker instance");
            2
        }
    }
}

fn with_evaluator<T>(
    operation: impl FnOnce(&mut NlEvaluator) -> Result<T, String>,
) -> Result<T, String> {
    EVALUATOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        let evaluator = slot
            .as_mut()
            .ok_or_else(|| "no .nl model has been loaded".to_owned())?;
        operation(evaluator)
    })
}

unsafe fn input_slice<'a, T>(pointer: *const T, length: usize) -> Result<&'a [T], String> {
    if length == 0 {
        return Ok(&[]);
    }
    if pointer.is_null() {
        return Err("input pointer is null".to_owned());
    }
    // SAFETY: the ABI caller promises a readable, initialized allocation of
    // at least `length * size_of::<T>()` bytes in this module's memory.
    Ok(unsafe { std::slice::from_raw_parts(pointer, length) })
}

unsafe fn output_slice<'a, T>(pointer: *mut T, length: usize) -> Result<&'a mut [T], String> {
    if length == 0 {
        return Ok(&mut []);
    }
    if pointer.is_null() {
        return Err("output pointer is null".to_owned());
    }
    // SAFETY: the ABI caller promises a writable allocation of at least
    // `length * size_of::<T>()` bytes in this module's memory.
    Ok(unsafe { std::slice::from_raw_parts_mut(pointer, length) })
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_alloc(size: usize) -> *mut u8 {
    match layout(size) {
        // SAFETY: a non-zero, valid layout is passed to the global allocator.
        Some(layout) if size > 0 => unsafe { alloc(layout) },
        _ => std::ptr::null_mut(),
    }
}

/// # Safety
///
/// `pointer` and `size` must describe one live allocation returned by
/// [`acopf_alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_free(pointer: *mut u8, size: usize) {
    if pointer.is_null() {
        return;
    }
    if let Some(layout) = layout(size) {
        // SAFETY: required by this function's ABI contract.
        unsafe { dealloc(pointer, layout) };
    }
}

/// # Safety
///
/// `pointer`/`length` must describe UTF-8 `.nl` bytes in this module's
/// memory, valid for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_load(pointer: *const u8, length: usize) -> i32 {
    run(|| {
        // SAFETY: forwarded from this function's ABI contract.
        let bytes = unsafe { input_slice(pointer, length) }?;
        let evaluator = NlEvaluator::from_nl_bytes(bytes).map_err(|error| error.to_string())?;
        EVALUATOR.with(|slot| *slot.borrow_mut() = Some(evaluator));
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_last_error_length() -> usize {
    LAST_ERROR.with(|slot| slot.borrow().len())
}

/// # Safety
///
/// `output` must be writable for `length` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_copy_last_error(output: *mut u8, length: usize) -> usize {
    LAST_ERROR.with(|slot| {
        let error = slot.borrow();
        let count = length.min(error.len());
        if count > 0 && !output.is_null() {
            // SAFETY: required by this function's ABI contract; `count` is
            // bounded by both the supplied buffer length and source length.
            unsafe { std::ptr::copy_nonoverlapping(error.as_ptr(), output, count) };
        }
        count
    })
}

fn dimension(select: impl FnOnce(&acopf_nl_evaluator::Dimensions) -> usize) -> i32 {
    EVALUATOR.with(|slot| {
        let slot = slot.borrow();
        slot.as_ref()
            .and_then(|evaluator| i32::try_from(select(&evaluator.problem().dimensions)).ok())
            .unwrap_or(-1)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_n() -> i32 {
    dimension(|dimensions| dimensions.variables)
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_m() -> i32 {
    dimension(|dimensions| dimensions.constraints)
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_jacobian_nonzeros() -> i32 {
    dimension(|dimensions| dimensions.jacobian_nonzeros)
}

#[unsafe(no_mangle)]
pub extern "C" fn acopf_hessian_nonzeros() -> i32 {
    dimension(|dimensions| dimensions.hessian_nonzeros)
}

/// Copy one model vector into `output`.
///
/// Selectors: 0 = x0, 1 = x lower, 2 = x upper, 3 = g lower, 4 = g upper.
///
/// # Safety
///
/// `output` must be writable for `length` `f64` values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_copy_problem_vector(
    selector: u32,
    output: *mut f64,
    length: usize,
) -> i32 {
    run(|| {
        // SAFETY: forwarded from this function's ABI contract.
        let output = unsafe { output_slice(output, length) }?;
        with_evaluator(|evaluator| {
            let problem = evaluator.problem();
            let source = match selector {
                0 => &problem.initial_point,
                1 => &problem.variable_lower,
                2 => &problem.variable_upper,
                3 => &problem.constraint_lower,
                4 => &problem.constraint_upper,
                _ => return Err(format!("unknown problem-vector selector {selector}")),
            };
            if output.len() != source.len() {
                return Err(format!(
                    "problem-vector output has length {}; expected {}",
                    output.len(),
                    source.len()
                ));
            }
            output.copy_from_slice(source);
            Ok(())
        })
    })
}

/// Copy a sparse row or column index vector into `output`.
///
/// Selectors: 0 = Jacobian rows, 1 = Jacobian columns, 2 = Hessian rows,
/// 3 = Hessian columns.
///
/// # Safety
///
/// `output` must be writable for `length` `i32` values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_copy_structure(
    selector: u32,
    output: *mut i32,
    length: usize,
) -> i32 {
    run(|| {
        // SAFETY: forwarded from this function's ABI contract.
        let output = unsafe { output_slice(output, length) }?;
        with_evaluator(|evaluator| {
            let problem = evaluator.problem();
            let source = match selector {
                0 => &problem.jacobian.rows,
                1 => &problem.jacobian.columns,
                2 => &problem.hessian.rows,
                3 => &problem.hessian.columns,
                _ => return Err(format!("unknown structure selector {selector}")),
            };
            if output.len() != source.len() {
                return Err(format!(
                    "structure output has length {}; expected {}",
                    output.len(),
                    source.len()
                ));
            }
            output.copy_from_slice(source);
            Ok(())
        })
    })
}

/// # Safety
///
/// Input and output pointers must reference allocations in this module's
/// memory with the supplied element counts.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_eval_f(x: *const f64, x_length: usize, output: *mut f64) -> i32 {
    run(|| {
        // SAFETY: forwarded from this function's ABI contract.
        let x = unsafe { input_slice(x, x_length) }?;
        // SAFETY: one output value is required by the ABI contract.
        let output = unsafe { output_slice(output, 1) }?;
        output[0] =
            with_evaluator(|evaluator| evaluator.objective(x).map_err(|error| error.to_string()))?;
        Ok(())
    })
}

macro_rules! vector_evaluation {
    ($name:ident, $method:ident) => {
        /// # Safety
        ///
        /// Input and output pointers must reference allocations in this
        /// module's memory with the supplied element counts.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(
            x: *const f64,
            x_length: usize,
            output: *mut f64,
            output_length: usize,
        ) -> i32 {
            run(|| {
                // SAFETY: forwarded from this function's ABI contract.
                let x = unsafe { input_slice(x, x_length) }?;
                // SAFETY: forwarded from this function's ABI contract.
                let output = unsafe { output_slice(output, output_length) }?;
                let values = with_evaluator(|evaluator| {
                    evaluator.$method(x).map_err(|error| error.to_string())
                })?;
                if output.len() != values.len() {
                    return Err(format!(
                        "evaluation output has length {}; expected {}",
                        output.len(),
                        values.len()
                    ));
                }
                output.copy_from_slice(&values);
                Ok(())
            })
        }
    };
}

vector_evaluation!(acopf_eval_grad_f, objective_gradient);
vector_evaluation!(acopf_eval_g, constraints);
vector_evaluation!(acopf_eval_jac_g, jacobian_values);

/// # Safety
///
/// Input and output pointers must reference allocations in this module's
/// memory with the supplied element counts.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn acopf_eval_h(
    x: *const f64,
    x_length: usize,
    objective_factor: f64,
    lambda: *const f64,
    lambda_length: usize,
    output: *mut f64,
    output_length: usize,
) -> i32 {
    run(|| {
        // SAFETY: forwarded from this function's ABI contract.
        let x = unsafe { input_slice(x, x_length) }?;
        // SAFETY: forwarded from this function's ABI contract.
        let lambda = unsafe { input_slice(lambda, lambda_length) }?;
        // SAFETY: forwarded from this function's ABI contract.
        let output = unsafe { output_slice(output, output_length) }?;
        let values = with_evaluator(|evaluator| {
            evaluator
                .hessian_values(x, objective_factor, lambda)
                .map_err(|error| error.to_string())
        })?;
        if output.len() != values.len() {
            return Err(format!(
                "Hessian output has length {}; expected {}",
                output.len(),
                values.len()
            ));
        }
        output.copy_from_slice(&values);
        Ok(())
    })
}
