const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function qoderReasoning(info) {
  const offered = info.efforts ?? Object.keys(info.thinking_config?.enabled?.efforts ?? {});
  const supported = levels.filter(level => offered.includes(level));
  return {
    reasoning: supported.length > 0,
    thinkingLevelMap: {
      ...Object.fromEntries(['off', ...levels].map(level => [level, null])),
      ...(info.supportsDisabled === true || info.thinking_config?.disabled !== undefined ? { off: 'off' } : {}),
      ...Object.fromEntries(supported.map(level => [level, level]))
    }
  };
}

export function qoderModelPolicy(model, effort) {
  return () => ({ model, parameters: { reasoningEffort: effort } });
}
