# Roast.World Analyzer development workflow

These instructions apply to this repository and all directories below it.

## Required roles

- Planning and design: use GPT-5.6 Sol in the normal ChatGPT Web application.
- Code review: use GPT-5.6 Sol in the normal ChatGPT Web application.
- Implementation, file editing, command execution, and testing: use Codex / Luna.

## Required workflow

For changes to application code or behavior, follow this sequence:

1. Inspect the current repository without changing files. Summarize the existing behavior, relevant files, likely change locations, constraints, and current test commands.
2. Open the normal ChatGPT Web application in the browser, explicitly select GPT-5.6 Sol, and request an implementation plan. Provide enough repository context and requirements for Sol to cover the objective, completion criteria, change targets, existing behavior that must remain intact, data inputs and outputs, a minimal-change approach, and test criteria.
3. Read Sol's actual response. Codex / Luna must implement from that plan, keeping changes small and preserving existing behavior. If implementation must materially diverge from the plan, record the reason instead of silently making a broad change.
4. Run the repository's required checks, including Worker JavaScript syntax, embedded browser JavaScript syntax, existing API route preservation, and relevant automated tests.
5. In the normal ChatGPT Web application, give GPT-5.6 Sol the changed-file list, actual `git diff`, test results, implementation decisions, and known remaining issues. Request a code review that checks requirements, likely bugs, unnecessary complexity, missing-data behavior, effects on existing functionality, and test gaps.
6. If Sol identifies a major or clear defect, Codex / Luna must make the smallest appropriate correction and rerun the tests. Do not implement optional redesigns or speculative expansion unless the user requests them.
7. Report the Sol design summary, Codex / Luna changes, Sol review findings, corrections made, and final test results.

## Non-substitution rules

- Design and review must use the normal signed-in ChatGPT Web application through the browser.
- Do not replace Web GPT-5.6 Sol with the OpenAI API.
- Do not replace Web GPT-5.6 Sol with a Codex internal model or subagent.
- Do not claim that Sol was consulted unless its response was actually obtained and read.
- If the ChatGPT Web application or GPT-5.6 Sol cannot be accessed, stop before implementation and report the exact failure. Do not create a substitute design or review.

## Scope and efficiency

- Keep Sol focused on planning and review. Keep Codex / Luna focused on implementation, execution, and testing.
- Avoid unnecessary back-and-forth. One design request and one post-implementation review should normally be sufficient.
- Do not expose secrets, credentials, tokens, private PDFs, or unnecessary user data in prompts sent to ChatGPT Web.
- Read-only investigation, status reporting, and changes limited to documentation or repository workflow configuration do not require a Sol design/review cycle unless the user explicitly requests one.
- User instructions for the current task take precedence over this default workflow.

## Existing project safeguards

- Treat the GitHub repository as the source of truth.
- Preserve existing features and API routes, and implement in small change units.
- After application changes, check Worker JavaScript syntax, embedded browser JavaScript syntax, existing API routes, and relevant tests.
- For roast analysis, keep evidence categories separate: the user's own roast experiments; peer-reviewed research and food science; official SCA/WCRC/Aillio materials; competition winners, leading competitors, and expert experience; and AI hypotheses.
- Do not directly generalize concrete roast conditions across different coffees.
- A proposed next roast experiment should normally change only one variable.
