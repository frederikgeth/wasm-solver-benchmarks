using JuMP
using SHA

function export_hs071(output_directory::String)
    mkpath(output_directory)
    model = Model()
    @variable(model, 1 <= x[1:4] <= 5)
    for (variable, start) in zip(x, (1.0, 5.0, 5.0, 1.0))
        set_start_value(variable, start)
    end
    @NLobjective(model, Min, x[1] * x[4] * (x[1] + x[2] + x[3]) + x[3])
    @NLconstraint(model, product_limit, x[1] * x[2] * x[3] * x[4] >= 25)
    @NLconstraint(model, sphere, sum(x[i]^2 for i in 1:4) == 40)

    nl_path = joinpath(output_directory, "hs071.nl")
    write_to_file(model, nl_path)
    digest = bytes2hex(sha256(read(nl_path)))

    metadata = """{
  "schema": "acopf-wasm-bench.fixture/v1",
  "model": "HS071",
  "generator": "julia/export_tiny_fixture.jl",
  "sha256": "$digest",
  "variables": ["x[1]", "x[2]", "x[3]", "x[4]"],
  "constraints": [
    {"name": "product_limit", "exported_expression": "x[1]*x[2]*x[3]*x[4] - 25", "lower": 0.0, "upper": "inf"},
    {"name": "sphere", "exported_expression": "sum(x[i]^2 for i=1:4) - 40", "lower": 0.0, "upper": 0.0}
  ],
  "initial_point": [1.0, 5.0, 5.0, 1.0]
}
"""
    write(joinpath(output_directory, "hs071.json"), metadata)
    return nl_path
end

if abspath(PROGRAM_FILE) == @__FILE__
    output_directory = length(ARGS) == 1 ? ARGS[1] : joinpath(@__DIR__, "..", "fixtures", "tiny")
    println(export_hs071(abspath(output_directory)))
end
