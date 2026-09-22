using Ipopt
using JSON
using JuMP
using PowerModels
using SHA

const MOI = JuMP.MOI

bound_value(value::Real) = isfinite(value) ? Float64(value) : (value > 0 ? "inf" : "-inf")

function write_json(path::String, value)
    open(path, "w") do io
        JSON.print(io, value, 2)
        println(io)
    end
end

function export_nl_with_mapping(
    model::JuMP.Model,
    output_directory::String,
    artifact_stem::String,
)
    nl_model = MOI.FileFormats.NL.Model()
    source = JuMP.backend(model)
    index_map = MOI.copy_to(nl_model, source)

    nl_path = joinpath(output_directory, "$artifact_stem.nl")
    open(nl_path, "w") do io
        write(io, nl_model)
    end

    source_variables = Dict(JuMP.index(variable) => variable for variable in all_variables(model))
    variable_mapping = Any[]
    column_names = String[]
    for (offset, variable_index) in enumerate(nl_model.order)
        variable = source_variables[variable_index]
        variable_name = isempty(name(variable)) ? "variable_$(variable_index.value)" : name(variable)
        info = nl_model.x[variable_index]
        push!(column_names, variable_name)
        push!(variable_mapping, Dict(
            "nl_index" => offset - 1,
            "jump_index" => variable_index.value,
            "name" => variable_name,
            "start" => something(info.start, 0.0),
            "lower" => bound_value(info.lower),
            "upper" => bound_value(info.upper),
        ))
    end
    col_path = joinpath(output_directory, "$artifact_stem.col")
    write(col_path, join(column_names, "\n") * "\n")

    nonlinear_count = length(nl_model.g)
    constraint_count = nonlinear_count + length(nl_model.h)
    row_names = fill("", constraint_count)
    constraint_mapping = Any[]
    for (function_type, set_type) in MOI.get(source, MOI.ListOfConstraintTypesPresent())
        function_type == MOI.VariableIndex && continue
        indices = MOI.get(source, MOI.ListOfConstraintIndices{function_type,set_type}())
        for source_index in indices
            destination_index = index_map[source_index]
            destination_index.value < 0 && continue
            constraint_function = MOI.get(source, MOI.ConstraintFunction(), source_index)
            expression = MOI.FileFormats.NL._NLExpr(constraint_function)
            row = expression.is_linear ? nonlinear_count + destination_index.value : destination_index.value
            bucket = expression.is_linear ? "linear" : "nonlinear"
            label = "$(bucket)_$(nameof(function_type))_$(nameof(set_type))_$(source_index.value)"
            row_names[row] = label
            constraint = row <= nonlinear_count ? nl_model.g[row] : nl_model.h[row - nonlinear_count]
            push!(constraint_mapping, Dict(
                "nl_index" => row - 1,
                "name" => label,
                "bucket" => bucket,
                "source_function_type" => string(function_type),
                "source_set_type" => string(set_type),
                "source_index" => source_index.value,
                "expression" => sprint(show, constraint_function),
                "lower" => bound_value(constraint.lower),
                "upper" => bound_value(constraint.upper),
            ))
        end
    end
    @assert all(!isempty, row_names)
    sort!(constraint_mapping; by = row -> row["nl_index"])
    row_path = joinpath(output_directory, "$artifact_stem.row")
    write(row_path, join(row_names, "\n") * "\n")

    return (
        nl_path = nl_path,
        col_path = col_path,
        row_path = row_path,
        variables = variable_mapping,
        constraints = constraint_mapping,
        nonlinear_constraints = nonlinear_count,
    )
end

function export_acopf_fixture(
    case_path::String,
    output_directory::String,
    artifact_stem::String,
    case_label::String,
)
    mkpath(output_directory)
    data = PowerModels.parse_file(case_path)
    pm = PowerModels.instantiate_model(data, PowerModels.ACPPowerModel, PowerModels.build_opf)
    exported = export_nl_with_mapping(pm.model, output_directory, artifact_stem)

    optimizer = optimizer_with_attributes(
        Ipopt.Optimizer,
        "print_level" => 0,
        "tol" => 1.0e-9,
        "max_iter" => 1000,
        "linear_solver" => "mumps",
    )
    result = PowerModels.optimize_model!(pm; optimizer = optimizer)

    mapping = Dict(
        "schema" => "acopf-wasm-bench.model-mapping/v1",
        "case" => case_label,
        "formulation" => "PowerModels.ACPPowerModel",
        "objective" => "PowerModels.build_opf fuel and flow cost",
        "source_case" => Dict(
            "path" => "fixtures/cases/$(basename(case_path))",
            "sha256" => bytes2hex(sha256(read(case_path))),
            "upstream" => "PowerModels.jl/test/data/matpower/$(basename(case_path))",
            "upstream_revision" => "f8ef54f762502cfae7760ea6314c4683b18b1ec5",
        ),
        "generator" => "julia/export_acopf_fixture.jl",
        "versions" => Dict(
            "julia" => string(VERSION),
            "JuMP" => string(pkgversion(JuMP)),
            "PowerModels" => string(pkgversion(PowerModels)),
            "Ipopt.jl" => string(pkgversion(Ipopt)),
        ),
        "artifacts" => Dict(
            "nl_sha256" => bytes2hex(sha256(read(exported.nl_path))),
            "col_sha256" => bytes2hex(sha256(read(exported.col_path))),
            "row_sha256" => bytes2hex(sha256(read(exported.row_path))),
        ),
        "dimensions" => Dict(
            "variables" => length(exported.variables),
            "constraints" => length(exported.constraints),
            "nonlinear_constraints" => exported.nonlinear_constraints,
        ),
        "variables" => exported.variables,
        "constraints" => exported.constraints,
    )
    write_json(joinpath(output_directory, "$artifact_stem.mapping.json"), mapping)

    reference = Dict(
        "schema" => "acopf-wasm-bench.reference-result/v1",
        "backend" => "PowerModels.ACPPowerModel + native Ipopt/MUMPS",
        "termination_status" => string(result["termination_status"]),
        "primal_status" => string(result["primal_status"]),
        "dual_status" => string(result["dual_status"]),
        "objective" => result["objective"],
        "solution" => result["solution"],
        "model_sha256" => mapping["artifacts"]["nl_sha256"],
        "options" => Dict(
            "tol" => 1.0e-9,
            "max_iter" => 1000,
            "linear_solver" => "mumps",
        ),
    )
    write_json(joinpath(output_directory, "$artifact_stem.reference.json"), reference)
    return reference
end

if abspath(PROGRAM_FILE) == @__FILE__
    root = abspath(joinpath(@__DIR__, ".."))
    case_path = length(ARGS) >= 1 ? abspath(ARGS[1]) : joinpath(root, "fixtures", "cases", "case3.m")
    case_name = splitext(basename(case_path))[1]
    output_directory = length(ARGS) >= 2 ? abspath(ARGS[2]) : joinpath(root, "fixtures", "acopf", case_name)
    artifact_stem = length(ARGS) >= 3 ? ARGS[3] : "$case_name-acopf"
    case_label = length(ARGS) >= 4 ? ARGS[4] : "PowerModels $case_name"
    reference = export_acopf_fixture(case_path, output_directory, artifact_stem, case_label)
    println(JSON.json(Dict(
        "output_directory" => output_directory,
        "termination_status" => reference["termination_status"],
        "objective" => reference["objective"],
    )))
end
