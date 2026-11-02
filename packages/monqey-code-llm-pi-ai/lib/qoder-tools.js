// The Qoder Agent SDK bridge is text-only, so Monqey tools travel as a tagged
// JSON protocol inside the answer text instead of native tool-call events.
const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";
const CALL = /<tool_call>([\s\S]*?)<\/tool_call>/g;
/** Render one assistant tool call the way the model is asked to write it. */
export function qoderToolCallText(name, args) {
	return `${OPEN}${JSON.stringify({ name, arguments: args ?? {} })}${CLOSE}`;
}
/** Describe the available Monqey tools and the call format for the prompt. */
export function qoderToolsPrompt(tools) {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const lines = tools.map((tool) => `- ${tool.name}: ${tool.description ?? ""}\n  parameters (JSON Schema): ${JSON.stringify(tool.parameters ?? {})}`);
	return [
		"TOOLS available through Monqey Agent:",
		lines.join("\n"),
		`To use a tool, write exactly ${OPEN}{"name":"<tool name>","arguments":{...}}${CLOSE} in your answer. You may write several calls in one answer.`,
		"Stop after the calls: Monqey Agent runs them and sends the results back as TOOL RESULT. Never invent tool results.",
		"Without a tool call, answer normally."
	].join("\n");
}
/** Length of text that cannot be the start of a tool call and is safe to stream. */
export function qoderSafeLength(text) {
	const start = text.indexOf(OPEN);
	if (start >= 0) return start;
	for (let k = Math.min(OPEN.length - 1, text.length); k > 0; k--) if (text.endsWith(OPEN.slice(0, k))) return text.length - k;
	return text.length;
}
/** Split an answer into visible text and valid calls for the known tool names. */
export function qoderParseToolCalls(text, toolNames) {
	const calls = [];
	const visible = text.replace(CALL, (whole, json) => {
		try {
			const parsed = JSON.parse(json);
			if (typeof parsed?.name !== "string" || !toolNames.has(parsed.name)) return whole;
			const args = parsed.arguments ?? {};
			if (typeof args !== "object" || args === null || Array.isArray(args)) return whole;
			calls.push({ name: parsed.name, arguments: args });
			return "";
		} catch {
			return whole;
		}
	});
	return { text: visible, calls };
}
