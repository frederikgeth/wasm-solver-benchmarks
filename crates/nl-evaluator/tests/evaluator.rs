use acopf_nl_evaluator::{NlEvaluator, SparseStructure};
use pounce_rs::prelude::{ApplicationReturnStatus, IpoptApplication, TNLP};
use std::cell::RefCell;
use std::rc::Rc;

const HS071: &str = include_str!("../../../fixtures/tiny/hs071.nl");
const CASE3_ACOPF: &str = include_str!("../../../fixtures/acopf/case3/case3-acopf.nl");
const CASE14_ACOPF: &str = include_str!("../../../fixtures/acopf/case14/case14-acopf.nl");
const CASE30_ACOPF: &str = include_str!("../../../fixtures/acopf/case30/case30-acopf.nl");

fn assert_close(actual: &[f64], expected: &[f64], tolerance: f64) {
    assert_eq!(actual.len(), expected.len());
    for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
        assert!(
            (actual - expected).abs() <= tolerance,
            "entry {index}: actual {actual}, expected {expected}"
        );
    }
}

fn dense_symmetric(structure: &SparseStructure, values: &[f64], n: usize) -> Vec<Vec<f64>> {
    let mut dense = vec![vec![0.0; n]; n];
    for ((&row, &column), &value) in structure.rows.iter().zip(&structure.columns).zip(values) {
        let row = row as usize;
        let column = column as usize;
        dense[row][column] = value;
        dense[column][row] = value;
    }
    dense
}

fn max_abs_difference(actual: &[f64], expected: &[f64]) -> f64 {
    actual
        .iter()
        .zip(expected)
        .map(|(actual, expected)| (actual - expected).abs())
        .fold(0.0, f64::max)
}

fn lagrangian_gradient(
    evaluator: &mut NlEvaluator,
    x: &[f64],
    objective_factor: f64,
    lambda: &[f64],
) -> Vec<f64> {
    let mut gradient = evaluator.objective_gradient(x).unwrap();
    for value in &mut gradient {
        *value *= objective_factor;
    }
    let jacobian = evaluator.jacobian_values(x).unwrap();
    for ((&row, &column), value) in evaluator
        .problem()
        .jacobian
        .rows
        .iter()
        .zip(&evaluator.problem().jacobian.columns)
        .zip(jacobian)
    {
        gradient[column as usize] += lambda[row as usize] * value;
    }
    gradient
}

#[test]
fn exposes_ipopt_compatible_problem_data() {
    let evaluator = NlEvaluator::from_nl_str(HS071).unwrap();
    let problem = evaluator.problem();

    assert_eq!(problem.dimensions.variables, 4);
    assert_eq!(problem.dimensions.constraints, 2);
    assert_eq!(problem.dimensions.jacobian_nonzeros, 8);
    assert_eq!(problem.dimensions.hessian_nonzeros, 10);
    assert_eq!(problem.variable_lower, vec![1.0; 4]);
    assert_eq!(problem.variable_upper, vec![5.0; 4]);
    // JuMP's NL writer moves each row's constant into the expression. The
    // exported rows are product(x) - 25 >= 0 and sum(x^2) - 40 == 0.
    assert_eq!(problem.constraint_lower, vec![0.0, 0.0]);
    assert!(problem.constraint_upper[0] >= 1.0e19);
    assert_eq!(problem.constraint_upper[1], 0.0);
    assert_eq!(problem.initial_point, vec![1.0, 5.0, 5.0, 1.0]);

    assert!(
        problem
            .hessian
            .rows
            .iter()
            .zip(&problem.hessian.columns)
            .all(|(row, column)| row >= column)
    );
}

#[test]
fn evaluates_values_and_derivatives_at_the_exported_start() {
    let mut evaluator = NlEvaluator::from_nl_str(HS071).unwrap();
    let x = evaluator.problem().initial_point.clone();

    assert!((evaluator.objective(&x).unwrap() - 16.0).abs() <= 1.0e-14);
    assert_close(
        &evaluator.objective_gradient(&x).unwrap(),
        &[12.0, 1.0, 2.0, 11.0],
        1.0e-14,
    );
    assert_close(&evaluator.constraints(&x).unwrap(), &[0.0, 12.0], 1.0e-14);
    assert_close(
        &evaluator.jacobian_values(&x).unwrap(),
        &[25.0, 5.0, 5.0, 25.0, 2.0, 10.0, 10.0, 2.0],
        1.0e-14,
    );

    let hessian_values = evaluator.hessian_values(&x, 1.0, &[0.5, -0.25]).unwrap();
    let hessian = dense_symmetric(&evaluator.problem().hessian, &hessian_values, 4);
    let expected = [
        [1.5, 3.5, 3.5, 24.5],
        [3.5, -0.5, 0.5, 3.5],
        [3.5, 0.5, -0.5, 3.5],
        [24.5, 3.5, 3.5, -0.5],
    ];
    for (actual, expected) in hessian.iter().zip(expected) {
        assert_close(actual, &expected, 1.0e-13);
    }
}

#[test]
fn finite_differences_validate_derivatives_at_multiple_points() {
    let mut evaluator = NlEvaluator::from_nl_str(HS071).unwrap();
    let points = [[1.2, 4.0, 3.5, 1.5], [2.0, 2.5, 3.0, 1.25]];
    let step_sizes = [1.0e-4, 1.0e-5, 1.0e-6];

    for point in points {
        let exact_gradient = evaluator.objective_gradient(&point).unwrap();
        let exact_jacobian = evaluator.jacobian_values(&point).unwrap();
        let mut best_gradient_error = f64::INFINITY;
        let mut best_jacobian_error = f64::INFINITY;

        for step in step_sizes {
            let mut fd_gradient = vec![0.0; point.len()];
            let mut fd_jacobian = vec![0.0; exact_jacobian.len()];
            for column in 0..point.len() {
                let mut plus = point;
                let mut minus = point;
                plus[column] += step;
                minus[column] -= step;
                fd_gradient[column] = (evaluator.objective(&plus).unwrap()
                    - evaluator.objective(&minus).unwrap())
                    / (2.0 * step);
                let g_plus = evaluator.constraints(&plus).unwrap();
                let g_minus = evaluator.constraints(&minus).unwrap();
                for (index, (&row, &entry_column)) in evaluator
                    .problem()
                    .jacobian
                    .rows
                    .iter()
                    .zip(&evaluator.problem().jacobian.columns)
                    .enumerate()
                {
                    if entry_column as usize == column {
                        fd_jacobian[index] =
                            (g_plus[row as usize] - g_minus[row as usize]) / (2.0 * step);
                    }
                }
            }
            best_gradient_error =
                best_gradient_error.min(max_abs_difference(&fd_gradient, &exact_gradient));
            best_jacobian_error =
                best_jacobian_error.min(max_abs_difference(&fd_jacobian, &exact_jacobian));
        }

        assert!(
            best_gradient_error <= 1.0e-7,
            "gradient error {best_gradient_error}"
        );
        assert!(
            best_jacobian_error <= 1.0e-7,
            "Jacobian error {best_jacobian_error}"
        );
    }

    let point = points[0];
    let direction = [0.3, -0.7, 0.2, 0.5];
    let objective_factor = 0.8;
    let lambda = [0.4, -0.3];
    let hessian_values = evaluator
        .hessian_values(&point, objective_factor, &lambda)
        .unwrap();
    let hessian = dense_symmetric(&evaluator.problem().hessian, &hessian_values, point.len());
    let exact_product: Vec<f64> = hessian
        .iter()
        .map(|row| row.iter().zip(direction).map(|(a, b)| a * b).sum())
        .collect();
    let mut best_hessian_error = f64::INFINITY;
    for step in step_sizes {
        let mut plus = point;
        let mut minus = point;
        for index in 0..point.len() {
            plus[index] += step * direction[index];
            minus[index] -= step * direction[index];
        }
        let plus_gradient = lagrangian_gradient(&mut evaluator, &plus, objective_factor, &lambda);
        let minus_gradient = lagrangian_gradient(&mut evaluator, &minus, objective_factor, &lambda);
        let finite_difference: Vec<f64> = plus_gradient
            .iter()
            .zip(minus_gradient)
            .map(|(plus, minus)| (plus - minus) / (2.0 * step))
            .collect();
        best_hessian_error =
            best_hessian_error.min(max_abs_difference(&finite_difference, &exact_product));
    }
    assert!(
        best_hessian_error <= 1.0e-7,
        "Hessian-vector error {best_hessian_error}"
    );
}

#[test]
fn pounce_solves_the_same_evaluator() {
    let evaluator = NlEvaluator::from_nl_str(HS071).unwrap();
    let tnlp = Rc::new(RefCell::new(evaluator.into_tnlp()));
    let target = Rc::clone(&tnlp) as Rc<RefCell<dyn TNLP>>;

    let mut application = IpoptApplication::new();
    application
        .initialize_with_options_str("print_level 0\ntol 1e-9\nmax_iter 100\n")
        .unwrap();
    let status = application.optimize_tnlp(target);

    assert_eq!(status, ApplicationReturnStatus::SolveSucceeded);
    let evaluator = tnlp.borrow();
    let x = evaluator.final_x().unwrap();
    assert!((evaluator.final_obj() - 17.014_017_145_179).abs() <= 1.0e-6);
    assert!((x[0] - 1.0).abs() <= 1.0e-6);
    assert!(application.statistics().final_declared_constr_viol <= 1.0e-6);
}

fn assert_evaluates_and_solves_power_models_acopf(
    nl: &str,
    dimensions: (usize, usize, usize, usize),
    expected_objective: f64,
) {
    let mut evaluator = NlEvaluator::from_nl_str(nl).unwrap();
    let actual_dimensions = &evaluator.problem().dimensions;
    assert_eq!(actual_dimensions.variables, dimensions.0);
    assert_eq!(actual_dimensions.constraints, dimensions.1);
    assert_eq!(actual_dimensions.jacobian_nonzeros, dimensions.2);
    assert_eq!(actual_dimensions.hessian_nonzeros, dimensions.3);

    let initial_point = evaluator.problem().initial_point.clone();
    assert!(evaluator.objective(&initial_point).unwrap().is_finite());
    assert!(
        evaluator
            .objective_gradient(&initial_point)
            .unwrap()
            .iter()
            .all(|value| value.is_finite())
    );
    assert!(
        evaluator
            .constraints(&initial_point)
            .unwrap()
            .iter()
            .all(|value| value.is_finite())
    );
    assert!(
        evaluator
            .jacobian_values(&initial_point)
            .unwrap()
            .iter()
            .all(|value| value.is_finite())
    );
    assert!(
        evaluator
            .hessian_values(&initial_point, 1.0, &vec![0.0; dimensions.1])
            .unwrap()
            .iter()
            .all(|value| value.is_finite())
    );

    let tnlp = Rc::new(RefCell::new(evaluator.into_tnlp()));
    let target = Rc::clone(&tnlp) as Rc<RefCell<dyn TNLP>>;
    let mut application = IpoptApplication::new();
    application
        .initialize_with_options_str("print_level 0\ntol 1e-9\nmax_iter 1000\n")
        .unwrap();
    let status = application.optimize_tnlp(target);

    assert_eq!(status, ApplicationReturnStatus::SolveSucceeded);
    let evaluator = tnlp.borrow();
    assert!((evaluator.final_obj() - expected_objective).abs() <= 1.0e-3);
    assert!(application.statistics().final_declared_constr_viol <= 1.0e-6);
}

#[test]
fn evaluates_and_solves_power_models_case3_acopf() {
    assert_evaluates_and_solves_power_models_acopf(
        CASE3_ACOPF,
        (28, 29, 103, 35),
        5_906.879_416_645_711,
    );
}

#[test]
fn evaluates_and_solves_power_models_case14_acopf() {
    assert_evaluates_and_solves_power_models_acopf(
        CASE14_ACOPF,
        (118, 129, 532, 127),
        8_081.524_734_833_99,
    );
}

#[test]
fn evaluates_and_solves_power_models_case30_acopf() {
    assert_evaluates_and_solves_power_models_acopf(
        CASE30_ACOPF,
        (236, 348, 1_245, 418),
        204.968_350_791_294_82,
    );
}
