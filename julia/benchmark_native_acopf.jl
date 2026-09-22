using Ipopt
using JSON
using PowerModels

const ROOT = abspath(joinpath(@__DIR__, ".."))

function usage()
    return """
    usage: benchmark_native_acopf.jl --output PATH [options]

      --cases LIST    comma-separated case names (default: case118,case300,case1354,case6468)
      --runs N        measured fresh-model runs per case (default: 7)
      --warmups N     unmeasured warmups per case (default: 1)
    """
end

function parse_nonnegative_integer(raw::String, name::String; positive::Bool = false)
    value = tryparse(Int, raw)
    minimum = positive ? 1 : 0
    if value === nothing || value < minimum
        error("$name must be an integer >= $minimum")
    end
    return value
end

function parse_arguments(arguments::Vector{String})
    options = Dict{String,Any}(
        "cases" => ["case118", "case300", "case1354", "case6468"],
        "runs" => 7,
        "warmups" => 1,
        "output" => nothing,
    )
    index = 1
    while index <= length(arguments)
        argument = arguments[index]
        if argument in ("--help", "-h")
            println(usage())
            exit(0)
        elseif argument in ("--cases", "--runs", "--warmups", "--output")
            index += 1
            index <= length(arguments) || error("$argument requires a value")
            value = arguments[index]
            if argument == "--cases"
                options["cases"] = String.(filter(item -> !isempty(item), split(value, ',')))
            elseif argument == "--runs"
                options["runs"] = parse_nonnegative_integer(value, argument; positive = true)
            elseif argument == "--warmups"
                options["warmups"] = parse_nonnegative_integer(value, argument)
            else
                options["output"] = abspath(joinpath(ROOT, value))
            end
        else
            error("unknown argument: $argument\n\n$(usage())")
        end
        index += 1
    end
    options["output"] === nothing && error("--output is required\n\n$(usage())")
    isempty(options["cases"]) && error("--cases must not be empty")
    for case_name in options["cases"]
        occursin(r"^case[0-9]+$", case_name) || error("invalid case name: $case_name")
    end
    return options
end

milliseconds_since(start::UInt64) = (time_ns() - start) / 1.0e6

function quantile(sorted::Vector{Float64}, probability::Float64)
    isempty(sorted) && return nothing
    position = (length(sorted) - 1) * probability
    lower = floor(Int, position) + 1
    upper = ceil(Int, position) + 1
    lower == upper && return sorted[lower]
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - floor(position))
end

function statistics(values)
    sorted = sort(Float64[value for value in values if isfinite(value)])
    return Dict(
        "count" => length(sorted),
        "min" => isempty(sorted) ? nothing : first(sorted),
        "p25" => quantile(sorted, 0.25),
        "median" => quantile(sorted, 0.5),
        "p75" => quantile(sorted, 0.75),
        "max" => isempty(sorted) ? nothing : last(sorted),
    )
end

function build_optimizer()
    return optimizer_with_attributes(
        Ipopt.Optimizer,
        "print_level" => 0,
        "tol" => 1.0e-9,
        "max_iter" => 1000,
        "linear_solver" => "mumps",
    )
end

function run_once(
    data,
    case_name::String,
    reference_objective::Float64,
    run_kind::String,
    run_index::Int,
)
    construction_start = time_ns()
    model = PowerModels.instantiate_model(
        data,
        PowerModels.ACPPowerModel,
        PowerModels.build_opf,
    )
    construction_ms = milliseconds_since(construction_start)

    optimization_start = time_ns()
    result = PowerModels.optimize_model!(model; optimizer = build_optimizer())
    optimization_wall_ms = milliseconds_since(optimization_start)
    termination_status = string(result["termination_status"])
    objective = Float64(result["objective"])
    objective_difference = abs(objective - reference_objective)
    objective_matches = isapprox(objective, reference_objective; atol = 1.0e-6, rtol = 1.0e-8)
    passed = termination_status in ("LOCALLY_SOLVED", "OPTIMAL") && objective_matches
    return Dict(
        "run_kind" => run_kind,
        "run_index" => run_index,
        "case" => case_name,
        "backend" => "PowerModels + native Ipopt/MUMPS",
        "passed" => passed,
        "termination_status" => termination_status,
        "objective" => objective,
        "reference_objective" => reference_objective,
        "absolute_objective_difference" => objective_difference,
        "objective_matches_reference" => objective_matches,
        "timings_ms" => Dict(
            "model_construction" => construction_ms,
            "optimization_wall" => optimization_wall_ms,
            "solver_reported" => 1000.0 * result["solve_time"],
            "construction_plus_optimization" => construction_ms + optimization_wall_ms,
        ),
    )
end

function input_record(case_name::String)
    mapping_path = joinpath(ROOT, "fixtures", "acopf", case_name, "$case_name-acopf.mapping.json")
    reference_path = joinpath(ROOT, "fixtures", "acopf", case_name, "$case_name-acopf.reference.json")
    mapping = JSON.parsefile(mapping_path)
    reference = JSON.parsefile(reference_path)
    return Dict(
        "case" => case_name,
        "label" => mapping["case"],
        "mapping_path" => relpath(mapping_path, ROOT),
        "model_sha256" => mapping["artifacts"]["nl_sha256"],
        "source_case" => mapping["source_case"],
        "dimensions" => mapping["dimensions"],
        "reference_objective" => reference["objective"],
    )
end

function summary(case_name::String, observations)
    selected = filter(item -> item["case"] == case_name, observations)
    successes = filter(item -> item["passed"], selected)
    timing(name) = statistics(item["timings_ms"][name] for item in successes)
    return Dict(
        "case" => case_name,
        "backend" => "PowerModels + native Ipopt/MUMPS",
        "attempts" => length(selected),
        "successes" => length(successes),
        "failures" => length(selected) - length(successes),
        "objective" => isempty(successes) ? nothing : successes[1]["objective"],
        "model_construction_ms" => timing("model_construction"),
        "optimization_wall_ms" => timing("optimization_wall"),
        "solver_reported_ms" => timing("solver_reported"),
        "construction_plus_optimization_ms" => timing("construction_plus_optimization"),
    )
end

function git_output(arguments...)
    return readchomp(`git -C $ROOT $(arguments)`)
end

function main()
    options = parse_arguments(ARGS)
    PowerModels.silence()
    inputs = [input_record(case_name) for case_name in options["cases"]]
    reference_objectives = Dict(
        input["case"] => Float64(input["reference_objective"]) for input in inputs
    )
    warmups = Any[]
    observations = Any[]

    for case_name in options["cases"]
        case_path = joinpath(ROOT, "fixtures", "cases", "$case_name.m")
        isfile(case_path) || error("missing case file: $case_path")
        data = PowerModels.parse_file(case_path)
        for run_index in 1:options["warmups"]
            push!(warmups, run_once(
                data,
                case_name,
                reference_objectives[case_name],
                "warmup",
                run_index,
            ))
        end
        for run_index in 1:options["runs"]
            observation = run_once(
                data,
                case_name,
                reference_objectives[case_name],
                "measured",
                run_index,
            )
            push!(observations, observation)
            println(
                "$case_name run $run_index/$(options["runs"]): " *
                "$(round(observation["timings_ms"]["solver_reported"]; digits = 1)) ms, " *
                "$(observation["termination_status"])",
            )
        end
    end

    status = git_output("status", "--porcelain")
    report = Dict(
        "schema" => "acopf-wasm-bench.native-powermodels-benchmark/v1",
        "created_at" => string(Dates.now(Dates.UTC)),
        "passed" => all(item["passed"] for item in observations),
        "repository" => Dict(
            "commit" => git_output("rev-parse", "HEAD"),
            "worktree_dirty" => !isempty(status),
        ),
        "host" => Dict(
            "kernel" => string(Sys.KERNEL),
            "architecture" => string(Sys.ARCH),
            "cpu_model" => isempty(Sys.cpu_info()) ? nothing : Sys.cpu_info()[1].model,
            "logical_processors" => Sys.CPU_THREADS,
            "total_memory_bytes" => Sys.total_memory(),
        ),
        "runtime" => Dict(
            "julia" => string(VERSION),
            "PowerModels" => string(pkgversion(PowerModels)),
            "Ipopt.jl" => string(pkgversion(Ipopt)),
            "native_binary_versions" => "Pinned in julia/Manifest.toml (Ipopt_jll 300.1400.1902+0; MUMPS_seq_jll 500.900.100+0)",
        ),
        "protocol" => Dict(
            "cases" => options["cases"],
            "backend" => "PowerModels.ACPPowerModel + native Ipopt/MUMPS",
            "options" => Dict(
                "tol" => 1.0e-9,
                "max_iter" => 1000,
                "exact_hessian" => true,
                "linear_solver" => "mumps",
            ),
            "warmups_per_case" => options["warmups"],
            "measured_fresh_model_runs_per_case" => options["runs"],
            "concurrency" => 1,
            "julia_threads" => Threads.nthreads(),
            "openblas_threads_environment" => get(ENV, "OPENBLAS_NUM_THREADS", nothing),
            "solver_reported_definition" => "JuMP SolveTimeSec reported by native Ipopt; excludes PowerModels model construction and result extraction",
            "optimization_wall_definition" => "wall time around PowerModels.optimize_model!, including optimizer attachment, JuMP-to-Ipopt model transfer, native solve, and PowerModels result extraction",
            "model_construction_definition" => "wall time around PowerModels.instantiate_model with ACPPowerModel/build_opf; MATPOWER parsing is performed once per case outside measured runs",
            "logging_during_timed_solve" => false,
            "objective_gate" => "isapprox(reference; atol=1e-6, rtol=1e-8)",
        ),
        "inputs" => inputs,
        "warmups" => warmups,
        "observations" => observations,
        "summaries" => [summary(case_name, observations) for case_name in options["cases"]],
    )
    output_path = options["output"]
    mkpath(dirname(output_path))
    open(output_path, "w") do io
        JSON.print(io, report, 2)
        write(io, '\n')
    end
    println("wrote $output_path")
    return report["passed"] ? 0 : 1
end

using Dates
exit(main())
