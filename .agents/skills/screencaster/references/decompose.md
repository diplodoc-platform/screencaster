# Plan an instruction

1. Load Markdown with `screencaster_source`. A consumer may install a custom URL
   loader. Do not assume an HTML page can be used as Markdown unchanged.
2. Read the entire selected instruction. Identify goals, original conditions,
   required values and the visible result of each goal.
3. Produce one plan with the returned `sourceSha256` and a `steps` array. Each
   step contains a unique positive `id`, `actionText`, `expectedResult` and an
   exact nonempty `sourceQuote`. `condition` is optional.
4. Register it using `screencaster_plan` before recorded actions. Registration
   checks structure, source identity and quotes; you must also review meaning.

Keep a form and its final submission together when completing the goal requires
them. A button can create a draft while a separate interaction opens its editor;
do not invent an intermediate panel as the button's expected result. An optional
branch stays conditional. Do not replace a required action with merely displaying
the control, or submit an incomplete form to satisfy a prematurely split step.

Do not insert service-specific infrastructure preparation into the core plan.
The consumer supplies ready resources and authorization independently. Narration
is optional and is not required to register or execute a plan.
