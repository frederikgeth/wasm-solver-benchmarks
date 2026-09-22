//! Shared AMPL `.nl` evaluator for the benchmark backends.
//!
//! This is intentionally a small adapter over POUNCE's public evaluator. It
//! owns no AC OPF equations and can therefore feed the same parsed model and
//! derivative implementation to both POUNCE and Ipopt.

use std::error::Error;
use std::fmt::{Display, Formatter};

use pounce_nl::nl_reader::{NlTnlp, parse_nl_text};
use pounce_nlp::tnlp::{BoundsInfo, IndexStyle, SparsityRequest, StartingPoint, TNLP};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dimensions {
    pub variables: usize,
    pub constraints: usize,
    pub jacobian_nonzeros: usize,
    pub hessian_nonzeros: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SparseStructure {
    pub rows: Vec<i32>,
    pub columns: Vec<i32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProblemData {
    pub dimensions: Dimensions,
    pub variable_lower: Vec<f64>,
    pub variable_upper: Vec<f64>,
    pub constraint_lower: Vec<f64>,
    pub constraint_upper: Vec<f64>,
    pub initial_point: Vec<f64>,
    pub jacobian: SparseStructure,
    pub hessian: SparseStructure,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationError(String);

impl EvaluationError {
    fn callback(name: &str) -> Self {
        Self(format!("POUNCE NL evaluator callback `{name}` failed"))
    }

    fn length(name: &str, expected: usize, actual: usize) -> Self {
        Self(format!(
            "{name} has length {actual}; the model requires {expected}"
        ))
    }
}

impl Display for EvaluationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for EvaluationError {}

/// A parsed `.nl` model and its cached derivative evaluator.
///
/// The methods mirror `ipopt-wasm`'s JavaScript callback surface. Sparse
/// structures are fixed when the model is loaded; value arrays always use the
/// same order as their corresponding structure.
pub struct NlEvaluator {
    inner: NlTnlp,
    problem: ProblemData,
}

impl NlEvaluator {
    pub fn from_nl_bytes(bytes: &[u8]) -> Result<Self, EvaluationError> {
        let text = std::str::from_utf8(bytes)
            .map_err(|error| EvaluationError(format!(".nl input is not UTF-8 text: {error}")))?;
        Self::from_nl_str(text)
    }

    pub fn from_nl_str(text: &str) -> Result<Self, EvaluationError> {
        let parsed = parse_nl_text(text)
            .map_err(|error| EvaluationError(format!("could not parse .nl input: {error}")))?;
        let mut inner = NlTnlp::try_new(parsed)
            .map_err(|error| EvaluationError(format!("could not build NL evaluator: {error}")))?;

        let info = inner
            .get_nlp_info()
            .ok_or_else(|| EvaluationError::callback("get_nlp_info"))?;
        if info.index_style != IndexStyle::C {
            return Err(EvaluationError(
                "POUNCE NL evaluator did not report zero-based indexing".to_owned(),
            ));
        }

        let dimensions = Dimensions {
            variables: usize::try_from(info.n)
                .map_err(|_| EvaluationError("negative variable count".to_owned()))?,
            constraints: usize::try_from(info.m)
                .map_err(|_| EvaluationError("negative constraint count".to_owned()))?,
            jacobian_nonzeros: usize::try_from(info.nnz_jac_g)
                .map_err(|_| EvaluationError("negative Jacobian nonzero count".to_owned()))?,
            hessian_nonzeros: usize::try_from(info.nnz_h_lag)
                .map_err(|_| EvaluationError("negative Hessian nonzero count".to_owned()))?,
        };

        let mut variable_lower = vec![0.0; dimensions.variables];
        let mut variable_upper = vec![0.0; dimensions.variables];
        let mut constraint_lower = vec![0.0; dimensions.constraints];
        let mut constraint_upper = vec![0.0; dimensions.constraints];
        if !inner.get_bounds_info(BoundsInfo {
            x_l: &mut variable_lower,
            x_u: &mut variable_upper,
            g_l: &mut constraint_lower,
            g_u: &mut constraint_upper,
        }) {
            return Err(EvaluationError::callback("get_bounds_info"));
        }

        let mut initial_point = vec![0.0; dimensions.variables];
        let mut unused_z_lower = vec![0.0; dimensions.variables];
        let mut unused_z_upper = vec![0.0; dimensions.variables];
        let mut unused_lambda = vec![0.0; dimensions.constraints];
        if !inner.get_starting_point(StartingPoint {
            init_x: true,
            x: &mut initial_point,
            init_z: false,
            z_l: &mut unused_z_lower,
            z_u: &mut unused_z_upper,
            init_lambda: false,
            lambda: &mut unused_lambda,
        }) {
            return Err(EvaluationError::callback("get_starting_point"));
        }

        let jacobian = Self::jacobian_structure_from(&mut inner, &dimensions)?;
        let hessian = Self::hessian_structure_from(&mut inner, &dimensions)?;
        if hessian
            .rows
            .iter()
            .zip(&hessian.columns)
            .any(|(row, column)| row < column)
        {
            return Err(EvaluationError(
                "POUNCE NL evaluator returned an upper-triangular Hessian entry".to_owned(),
            ));
        }

        Ok(Self {
            inner,
            problem: ProblemData {
                dimensions,
                variable_lower,
                variable_upper,
                constraint_lower,
                constraint_upper,
                initial_point,
                jacobian,
                hessian,
            },
        })
    }

    pub fn problem(&self) -> &ProblemData {
        &self.problem
    }

    pub fn objective(&mut self, x: &[f64]) -> Result<f64, EvaluationError> {
        self.check_x(x)?;
        self.inner
            .eval_f(x, true)
            .ok_or_else(|| EvaluationError::callback("eval_f"))
    }

    pub fn objective_gradient(&mut self, x: &[f64]) -> Result<Vec<f64>, EvaluationError> {
        self.check_x(x)?;
        let mut values = vec![0.0; self.problem.dimensions.variables];
        if !self.inner.eval_grad_f(x, true, &mut values) {
            return Err(EvaluationError::callback("eval_grad_f"));
        }
        Ok(values)
    }

    pub fn constraints(&mut self, x: &[f64]) -> Result<Vec<f64>, EvaluationError> {
        self.check_x(x)?;
        let mut values = vec![0.0; self.problem.dimensions.constraints];
        if !self.inner.eval_g(x, true, &mut values) {
            return Err(EvaluationError::callback("eval_g"));
        }
        Ok(values)
    }

    pub fn jacobian_values(&mut self, x: &[f64]) -> Result<Vec<f64>, EvaluationError> {
        self.check_x(x)?;
        let mut values = vec![0.0; self.problem.dimensions.jacobian_nonzeros];
        if !self.inner.eval_jac_g(
            Some(x),
            true,
            SparsityRequest::Values {
                values: &mut values,
            },
        ) {
            return Err(EvaluationError::callback("eval_jac_g"));
        }
        Ok(values)
    }

    pub fn hessian_values(
        &mut self,
        x: &[f64],
        objective_factor: f64,
        constraint_multipliers: &[f64],
    ) -> Result<Vec<f64>, EvaluationError> {
        self.check_x(x)?;
        let expected = self.problem.dimensions.constraints;
        if constraint_multipliers.len() != expected {
            return Err(EvaluationError::length(
                "constraint multipliers",
                expected,
                constraint_multipliers.len(),
            ));
        }
        let mut values = vec![0.0; self.problem.dimensions.hessian_nonzeros];
        if !self.inner.eval_h(
            Some(x),
            true,
            objective_factor,
            Some(constraint_multipliers),
            true,
            SparsityRequest::Values {
                values: &mut values,
            },
        ) {
            return Err(EvaluationError::callback("eval_h"));
        }
        Ok(values)
    }

    fn check_x(&self, x: &[f64]) -> Result<(), EvaluationError> {
        let expected = self.problem.dimensions.variables;
        if x.len() != expected {
            return Err(EvaluationError::length("x", expected, x.len()));
        }
        Ok(())
    }

    fn jacobian_structure_from(
        inner: &mut NlTnlp,
        dimensions: &Dimensions,
    ) -> Result<SparseStructure, EvaluationError> {
        let mut rows = vec![0; dimensions.jacobian_nonzeros];
        let mut columns = vec![0; dimensions.jacobian_nonzeros];
        if !inner.eval_jac_g(
            None,
            false,
            SparsityRequest::Structure {
                irow: &mut rows,
                jcol: &mut columns,
            },
        ) {
            return Err(EvaluationError::callback("eval_jac_g structure"));
        }
        Ok(SparseStructure { rows, columns })
    }

    fn hessian_structure_from(
        inner: &mut NlTnlp,
        dimensions: &Dimensions,
    ) -> Result<SparseStructure, EvaluationError> {
        let mut rows = vec![0; dimensions.hessian_nonzeros];
        let mut columns = vec![0; dimensions.hessian_nonzeros];
        if !inner.eval_h(
            None,
            false,
            0.0,
            None,
            false,
            SparsityRequest::Structure {
                irow: &mut rows,
                jcol: &mut columns,
            },
        ) {
            return Err(EvaluationError::callback("eval_h structure"));
        }
        Ok(SparseStructure { rows, columns })
    }
}
