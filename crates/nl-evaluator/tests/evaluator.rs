use acopf_nl_evaluator::{NlEvaluator, SparseStructure};

const HS071: &str = include_str!("../../../fixtures/tiny/hs071.nl");

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
