using JSON
using PowerModels

function write_json(path::String, value)
    mkpath(dirname(path))
    open(path, "w") do io
        JSON.print(io, value, 2)
        println(io)
    end
end

function polynomial_value(coefficients, x::Float64)
    value = 0.0
    for coefficient in coefficients
        value = muladd(value, x, Float64(coefficient))
    end
    return value
end

function bound_value(value)
    value isa Real && return Float64(value)
    value == "inf" && return Inf
    value == "-inf" && return -Inf
    error("unsupported bound value: $value")
end

function validate_acopf_solution(
    case_path::String,
    mapping_path::String,
    candidate_path::String,
    output_path::String,
)
    data = PowerModels.parse_file(case_path)
    mapping = JSON.parsefile(mapping_path)
    candidate = JSON.parsefile(candidate_path)
    names = readlines(replace(mapping_path, ".mapping.json" => ".col"))
    x = Float64.(candidate["x"])

    length(names) == length(x) || error("column and primal-vector lengths differ")
    solver_succeeded = candidate["status"] == 0
    primal_by_name = Dict(name => x[index] for (index, name) in enumerate(names))
    variable(name) = get(primal_by_name, name) do
        error("candidate is missing variable $name")
    end
    arc_name(kind, id, from, to) = "0_$(kind)[($(id), $(from), $(to))]"

    p_balance = Dict(bus => 0.0 for bus in keys(data["bus"]))
    q_balance = Dict(bus => 0.0 for bus in keys(data["bus"]))
    branch_equations = Float64[]
    thermal_violations = Float64[]
    angle_violations = Float64[]

    for (id, branch) in data["branch"]
        branch["br_status"] == 0 && continue
        from = branch["f_bus"]
        to = branch["t_bus"]
        va_from = variable("0_va[$from]")
        va_to = variable("0_va[$to]")
        vm_from = variable("0_vm[$from]")
        vm_to = variable("0_vm[$to]")
        p_from = variable(arc_name("p", id, from, to))
        p_to = variable(arc_name("p", id, to, from))
        q_from = variable(arc_name("q", id, from, to))
        q_to = variable(arc_name("q", id, to, from))

        admittance = inv(complex(branch["br_r"], branch["br_x"]))
        g = real(admittance)
        b = imag(admittance)
        tap = branch["tap"]
        tr = tap * cos(branch["shift"])
        ti = tap * sin(branch["shift"])
        tap_squared = tap^2
        angle_from = va_from - va_to
        angle_to = -angle_from
        voltage_product = vm_from * vm_to

        expected_p_from = (g + branch["g_fr"]) / tap_squared * vm_from^2 +
            (-g * tr + b * ti) / tap_squared * voltage_product * cos(angle_from) +
            (-b * tr - g * ti) / tap_squared * voltage_product * sin(angle_from)
        expected_q_from = -(b + branch["b_fr"]) / tap_squared * vm_from^2 -
            (-b * tr - g * ti) / tap_squared * voltage_product * cos(angle_from) +
            (-g * tr + b * ti) / tap_squared * voltage_product * sin(angle_from)
        expected_p_to = (g + branch["g_to"]) * vm_to^2 +
            (-g * tr - b * ti) / tap_squared * voltage_product * cos(angle_to) +
            (-b * tr + g * ti) / tap_squared * voltage_product * sin(angle_to)
        expected_q_to = -(b + branch["b_to"]) * vm_to^2 -
            (-b * tr + g * ti) / tap_squared * voltage_product * cos(angle_to) +
            (-g * tr - b * ti) / tap_squared * voltage_product * sin(angle_to)

        append!(branch_equations, (
            p_from - expected_p_from,
            q_from - expected_q_from,
            p_to - expected_p_to,
            q_to - expected_q_to,
        ))
        p_balance[string(from)] += p_from
        q_balance[string(from)] += q_from
        p_balance[string(to)] += p_to
        q_balance[string(to)] += q_to

        rate_a = get(branch, "rate_a", Inf)
        if isfinite(rate_a)
            push!(thermal_violations, max(hypot(p_from, q_from) - rate_a, 0.0))
            push!(thermal_violations, max(hypot(p_to, q_to) - rate_a, 0.0))
        end
        push!(angle_violations, max(branch["angmin"] - angle_from, angle_from - branch["angmax"], 0.0))
    end

    dc_loss_residuals = Float64[]
    for (id, dcline) in data["dcline"]
        dcline["br_status"] == 0 && continue
        from = dcline["f_bus"]
        to = dcline["t_bus"]
        p_from = variable(arc_name("p_dc", id, from, to))
        p_to = variable(arc_name("p_dc", id, to, from))
        q_from = variable(arc_name("q_dc", id, from, to))
        q_to = variable(arc_name("q_dc", id, to, from))
        p_balance[string(from)] += p_from
        q_balance[string(from)] += q_from
        p_balance[string(to)] += p_to
        q_balance[string(to)] += q_to
        push!(dc_loss_residuals, (1.0 - dcline["loss1"]) * p_from + p_to - dcline["loss0"])
    end

    objective = 0.0
    for (id, generator) in data["gen"]
        generator["gen_status"] == 0 && continue
        pg = variable("0_pg[$id]")
        qg = variable("0_qg[$id]")
        bus = string(generator["gen_bus"])
        p_balance[bus] -= pg
        q_balance[bus] -= qg
        objective += polynomial_value(generator["cost"], pg)
    end
    for (id, dcline) in data["dcline"]
        dcline["br_status"] == 0 && continue
        objective += polynomial_value(
            dcline["cost"],
            variable(arc_name("p_dc", id, dcline["f_bus"], dcline["t_bus"])),
        )
    end

    for load in values(data["load"])
        load["status"] == 0 && continue
        bus = string(load["load_bus"])
        p_balance[bus] += load["pd"]
        q_balance[bus] += load["qd"]
    end
    for shunt in values(data["shunt"])
        shunt["status"] == 0 && continue
        bus = string(shunt["shunt_bus"])
        voltage_squared = variable("0_vm[$bus]")^2
        p_balance[bus] += shunt["gs"] * voltage_squared
        q_balance[bus] -= shunt["bs"] * voltage_squared
    end

    bound_violations = Float64[]
    for variable_mapping in mapping["variables"]
        value = x[variable_mapping["nl_index"] + 1]
        lower = bound_value(variable_mapping["lower"])
        upper = bound_value(variable_mapping["upper"])
        push!(bound_violations, max(lower - value, value - upper, 0.0))
    end

    reference_angle_residuals = [
        variable("0_va[$id]") for (id, bus) in data["bus"] if bus["bus_type"] == 3
    ]
    max_abs(items) = isempty(items) ? 0.0 : maximum(abs, items)
    base_mva = Float64(data["baseMVA"])
    max_p_balance = max_abs(values(p_balance))
    max_q_balance = max_abs(values(q_balance))
    max_branch_equation = max_abs(branch_equations)
    max_dc_loss = max_abs(dc_loss_residuals)
    max_thermal = isempty(thermal_violations) ? 0.0 : maximum(thermal_violations)
    max_angle = isempty(angle_violations) ? 0.0 : maximum(angle_violations)
    max_bound = isempty(bound_violations) ? 0.0 : maximum(bound_violations)
    max_reference_angle = max_abs(reference_angle_residuals)
    objective_difference = objective - Float64(candidate["objective"])

    tolerance = 1.0e-6
    passed = solver_succeeded && maximum((
        max_p_balance,
        max_q_balance,
        max_branch_equation,
        max_dc_loss,
        max_thermal,
        max_angle,
        max_bound,
        max_reference_angle,
    )) <= tolerance && abs(objective_difference) <= 1.0e-6

    report = Dict(
        "schema" => "acopf-wasm-bench.independent-validation/v1",
        "validator" => "explicit AC equations from the source MATPOWER case",
        "candidate" => relpath(candidate_path, dirname(dirname(output_path))),
        "candidate_status" => candidate["status"],
        "candidate_raw_status" => get(candidate, "raw_status", nothing),
        "passed" => passed,
        "tolerance" => tolerance,
        "base_mva" => base_mva,
        "objective" => objective,
        "candidate_objective" => candidate["objective"],
        "objective_difference" => objective_difference,
        "max_active_balance_pu" => max_p_balance,
        "max_active_balance_mw" => max_p_balance * base_mva,
        "max_reactive_balance_pu" => max_q_balance,
        "max_reactive_balance_mvar" => max_q_balance * base_mva,
        "max_branch_equation_residual_pu" => max_branch_equation,
        "max_branch_equation_residual_mva" => max_branch_equation * base_mva,
        "max_dc_loss_residual_pu" => max_dc_loss,
        "max_thermal_limit_violation_pu" => max_thermal,
        "max_thermal_limit_violation_mva" => max_thermal * base_mva,
        "max_angle_limit_violation_rad" => max_angle,
        "max_variable_bound_violation" => max_bound,
        "max_reference_angle_residual_rad" => max_reference_angle,
    )
    write_json(output_path, report)
    passed || error("independent AC OPF validation failed; see $output_path")
    return report
end

if abspath(PROGRAM_FILE) == @__FILE__
    root = abspath(joinpath(@__DIR__, ".."))
    case_path = length(ARGS) >= 1 ? abspath(ARGS[1]) : joinpath(root, "fixtures", "cases", "case3.m")
    mapping_path = length(ARGS) >= 2 ? abspath(ARGS[2]) : joinpath(root, "fixtures", "acopf", "case3", "case3-acopf.mapping.json")
    candidate_path = length(ARGS) >= 3 ? abspath(ARGS[3]) : joinpath(root, "results", "smoke", "case3-ipopt-wasm.json")
    output_path = length(ARGS) >= 4 ? abspath(ARGS[4]) : joinpath(root, "results", "smoke", "case3-ipopt-wasm.validation.json")
    report = validate_acopf_solution(case_path, mapping_path, candidate_path, output_path)
    println(JSON.json(report))
end
