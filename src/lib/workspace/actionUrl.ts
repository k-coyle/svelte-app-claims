export function workspaceActionUrl(actionName: string, clientId?: string | null) {
	const action = actionName.trim().replace(/^\?\//, '').replace(/^\//, '');
	const client = String(clientId ?? '').trim();
	const base = `?/${encodeURIComponent(action)}`;
	return client ? `${base}&client=${encodeURIComponent(client)}` : base;
}
