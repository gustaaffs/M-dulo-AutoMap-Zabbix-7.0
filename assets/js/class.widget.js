(function () {
	function esc(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function shortName(name, maxLen) {
		maxLen = maxLen || 16;
		name = String(name || '');
		return name.length > maxLen ? name.slice(0, maxLen) + '...' : name;
	}

	function naturalCompare(a, b) {
		return String(a).localeCompare(String(b), undefined, {
			numeric: true,
			sensitivity: 'base'
		});
	}

	function normalizeName(name) {
		name = String(name || '').trim().toLowerCase();
		if (name.indexOf('.') !== -1) {
			name = name.split('.')[0];
		}
		return name.trim();
	}

	function normalizePort(port) {
		if (!port) return '';
		let p = String(port).trim();
		p = p.replace(/\(.*?\)/g, '').trim();
		p = p.replace(/\s+/g, '');
		p = p.toLowerCase();
		p = p.replace(/^twentyfivegigabitethernet/, 'twe');
		p = p.replace(/^twentyfivegige/, 'twe');
		p = p.replace(/^hundredgigabitethernet/, 'hu');
		p = p.replace(/^hundredgige/, 'hu');
		p = p.replace(/^tengigabitethernet/, 'te');
		p = p.replace(/^gigabitethernet/, 'gi');
		p = p.replace(/^fastethernet/, 'fa');
		p = p.replace(/^ethernet/, 'eth');
		p = p.replace(/^port-channel/, 'po');
		return p;
	}

	// Interpreta o lastvalue do item de status operacional
	function interpretStatus(value) {
		const v = String(value || '').trim().toLowerCase();
		if (v === '1' || v.startsWith('up')) return 'up';
		if (v === '2' || v.startsWith('down')) return 'down';
		return 'unknown';
	}

	// Parseia item "Interface Fa0/1(descricao): Operational status"
	// Extrai o nome da interface antes do "(" e normaliza
	function parseStatusItem(item) {
		const host = normalizeName(item.host || '');
		const name = String(item.name || '');

		// Captura tudo entre "Interface " e "(" ou ":"
		const match = name.match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Operational status$/i);
		if (!match) return null;

		const rawIf = match[1].trim();
		const normPort = normalizePort(rawIf);

		if (!host || !normPort) return null;

		return { host, rawIf, normPort, value: String(item.value || '') };
	}

	function buildStatusMap(items) {
		const map = {};
		(items || []).forEach((item) => {
			const parsed = parseStatusItem(item);
			if (!parsed) return;
			if (!map[parsed.host]) map[parsed.host] = {};
			map[parsed.host][parsed.normPort] = {
				status: interpretStatus(parsed.value),
				rawIf: parsed.rawIf,
				value: parsed.value
			};
		});
		return map;
	}

	// Interpreta nome de item de tráfego: "Interface Fa0/1(...): Bits received|Bits sent"
	function parseTrafficItem(item) {
		const host = normalizeName(item.host || '');
		const name = String(item.name || '');

		const match = name.match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Bits\s+(received|sent)\s*$/i);
		if (!match) return null;

		const rawIf = match[1].trim();
		const normPort = normalizePort(rawIf);
		const direction = match[2].toLowerCase() === 'received' ? 'in' : 'out';

		if (!host || !normPort) return null;

		return {
			host,
			rawIf,
			normPort,
			direction,
			value: parseFloat(item.value),
			units: String(item.units || '')
		};
	}

	function buildTrafficMap(items) {
		const map = {};
		(items || []).forEach((item) => {
			const parsed = parseTrafficItem(item);
			if (!parsed) return;
			if (!map[parsed.host]) map[parsed.host] = {};
			if (!map[parsed.host][parsed.normPort]) {
				map[parsed.host][parsed.normPort] = { rawIf: parsed.rawIf };
			}
			map[parsed.host][parsed.normPort][parsed.direction] = parsed.value;
			map[parsed.host][parsed.normPort].units = parsed.units || 'bps';
		});
		return map;
	}

	function getTrafficInfo(trafficMap, host, port) {
		const h = normalizeName(host || '');
		const p = normalizePort(port || '');
		if (!h || !p || !trafficMap[h]) return null;
		return trafficMap[h][p] || null;
	}

	function formatBps(value) {
		if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '0 bps';
		const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
		let i = 0;
		let v = value;
		while (v >= 1000 && i < units.length - 1) {
			v /= 1000;
			i++;
		}
		return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' ' + units[i];
	}

	// Agrega status de uma lista de membros [{statusHost, statusPort}]
	// Retorna 'up' se ALGUM estiver up; 'down' se TODOS estiverem down; null se desconhecido.
	function aggregateMembersStatus(statusMap, members) {
		if (!members || !members.length) return null;
		let anyUp = false;
		let anyDown = false;
		let anyKnown = false;
		members.forEach((m) => {
			const info = getStatusInfo(statusMap, m.statusHost, m.statusPort);
			if (!info) return;
			anyKnown = true;
			if (info.status === 'up') anyUp = true;
			else if (info.status === 'down') anyDown = true;
		});
		if (!anyKnown) return null;
		if (anyUp) return 'up';
		if (anyDown) return 'down';
		return null;
	}

	// Soma de tráfego (in/out) de todos os membros conhecidos.
	function aggregateMembersTraffic(trafficMap, members) {
		if (!members || !members.length) return null;
		let inSum = 0, outSum = 0, hasIn = false, hasOut = false;
		members.forEach((m) => {
			const t = getTrafficInfo(trafficMap, m.statusHost, m.statusPort);
			if (!t) return;
			if (typeof t.in === 'number' && isFinite(t.in)) { inSum += t.in; hasIn = true; }
			if (typeof t.out === 'number' && isFinite(t.out)) { outSum += t.out; hasOut = true; }
		});
		if (!hasIn && !hasOut) return null;
		return {
			in: hasIn ? inSum : null,
			out: hasOut ? outSum : null
		};
	}

	// Speed item (bps). Nome no padrão "Interface XX(...): Speed".
	function parseSpeedItem(item) {
		const host = normalizeName(item.host || '');
		const name = String(item.name || '');
		const match = name.match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Speed\s*$/i);
		if (!match) return null;
		const rawIf = match[1].trim();
		const normPort = normalizePort(rawIf);
		if (!host || !normPort) return null;
		const value = parseFloat(item.value);
		const units = String(item.units || '').toLowerCase();
		// Converte para bps. Se units contém Mbps/Gbps converte; senão assume bps.
		let bps = value;
		if (isFinite(value)) {
			if (units.indexOf('gbps') !== -1 || units.indexOf('gbit') !== -1) bps = value * 1e9;
			else if (units.indexOf('mbps') !== -1 || units.indexOf('mbit') !== -1) bps = value * 1e6;
			else if (units.indexOf('kbps') !== -1 || units.indexOf('kbit') !== -1) bps = value * 1e3;
			// alguns templates já entregam em bps (ifHighSpeed * 1e6 já normalizado)
		}
		return { host, normPort, bps };
	}

	function buildSpeedMap(items) {
		const map = {};
		(items || []).forEach((item) => {
			const parsed = parseSpeedItem(item);
			if (!parsed || !isFinite(parsed.bps) || parsed.bps <= 0) return;
			if (!map[parsed.host]) map[parsed.host] = {};
			map[parsed.host][parsed.normPort] = parsed.bps;
		});
		return map;
	}

	function getSpeedBps(speedMap, host, port) {
		const h = normalizeName(host || '');
		const p = normalizePort(port || '');
		if (!h || !p || !speedMap[h]) return null;
		return speedMap[h][p] || null;
	}

	// Maior utilização (%) entre membros do link, considerando max(in,out)/speed.
	// Retorna { pct, peakBps, speedBps } ou null se desconhecido.
	function aggregateMembersUtilization(trafficMap, speedMap, members) {
		if (!members || !members.length) return null;
		let bestPct = -1;
		let peakBps = 0;
		let speedBps = 0;
		members.forEach((m) => {
			const t = getTrafficInfo(trafficMap, m.statusHost, m.statusPort);
			const sp = getSpeedBps(speedMap, m.statusHost, m.statusPort);
			if (!t || !sp || sp <= 0) return;
			const peak = Math.max(
				typeof t.in === 'number' ? t.in : 0,
				typeof t.out === 'number' ? t.out : 0
			);
			const pct = (peak / sp) * 100;
			if (pct > bestPct) {
				bestPct = pct;
				peakBps = peak;
				speedBps = sp;
			}
		});
		if (bestPct < 0) return null;
		return { pct: bestPct, peakBps, speedBps };
	}

	function colorForUtilization(pct, warnPct, critPct) {
		if (pct >= critPct) return '#ef4444';   // vermelho
		if (pct >= warnPct) return '#facc15';   // amarelo
		return '#22c55e';                       // verde
	}

	// Espessura proporcional à utilização (escala log para dar leitura mesmo em valores baixos).
	function strokeForUtilization(pct) {
		if (!isFinite(pct) || pct <= 0) return 1.6;
		const s = 1.6 + Math.log10(1 + pct) * 2.2; // ~1.6 a ~6
		return Math.min(7, Math.max(1.6, s));
	}

	function getStatusInfo(statusMap, host, port) {
		const h = normalizeName(host || '');
		const p = normalizePort(port || '');
		if (!h || !p || !statusMap[h]) return null;
		return statusMap[h][p] || null;
	}

	function anchorGroupKey(name) {
		let base = normalizeName(name);
		base = base.replace(/[-_.]?\d+$/, '');
		base = base.replace(/[-_.]+$/, '');
		return base || normalizeName(name);
	}

	const DRAG_GAIN = 1;

	function buildModel(links) {
		const nodesMap = {};
		const degreeMap = {};
		const adjacency = {};

		(links || []).forEach((link) => {
			const source = normalizeName(link.source || '');
			const target = normalizeName(link.target || '');
			const protocol = String(link.protocol || '');
			const port = String(link.port || '');
			const rawItem = String(link.raw_item || '');

			if (!source || !target) return;

			nodesMap[source] = source;
			nodesMap[target] = target;

			degreeMap[source] = (degreeMap[source] || 0) + 1;
			degreeMap[target] = (degreeMap[target] || 0) + 1;

			if (!adjacency[source]) adjacency[source] = [];
			if (!adjacency[target]) adjacency[target] = [];

			// statusHost = target porque a porta no item CDP é a porta do vizinho
			adjacency[source].push({
				peer: target,
				protocol: protocol,
				port: port,
				rawItem: rawItem,
				statusHost: target,
				statusPort: port
			});

			adjacency[target].push({
				peer: source,
				protocol: protocol,
				port: port,
				rawItem: rawItem,
				statusHost: target,
				statusPort: port
			});
		});

		Object.keys(adjacency).forEach((k) => {
			adjacency[k].sort((a, b) => naturalCompare(a.peer, b.peer));
		});

		const nodes = Object.keys(nodesMap).sort(naturalCompare);

		return { nodes, degreeMap, adjacency };
	}

	function groupAnchorsBySimilarity(anchors) {
		const map = {};

		anchors.forEach((anchor) => {
			const key = anchorGroupKey(anchor);
			if (!map[key]) map[key] = [];
			map[key].push(anchor);
		});

		return Object.keys(map)
			.sort(naturalCompare)
			.map((key) => ({
				key: key,
				anchors: map[key].sort(naturalCompare)
			}));
	}

	function getStorageKey(rootEl, anchors) {
		const groupId = rootEl.dataset.groupId || 'nogroup';
		const anchorKey = anchors && anchors.length ? anchors.slice().sort(naturalCompare).join('|') : 'auto';
		return 'topology-test-layout:' + groupId + ':' + anchorKey;
	}

	function loadSavedPositions(storageKey) {
		try {
			const raw = localStorage.getItem(storageKey);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : {};
		}
		catch (e) {
			return {};
		}
	}

	function saveSavedPositions(storageKey, positions) {
		try {
			localStorage.setItem(storageKey, JSON.stringify(positions));
		}
		catch (e) {}
	}

	function loadExpandedState(storageKey) {
		try {
			const raw = localStorage.getItem(storageKey + ':expanded');
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : {};
		}
		catch (e) {
			return {};
		}
	}

	function saveExpandedState(storageKey, expanded) {
		try {
			localStorage.setItem(storageKey + ':expanded', JSON.stringify(expanded));
		}
		catch (e) {}
	}

	function clientDeltaToSvg(svgEl, startClientX, startClientY, currentClientX, currentClientY) {
		const rect = svgEl.getBoundingClientRect();
		const viewBox = svgEl.viewBox.baseVal;

		// preserveAspectRatio="xMidYMid meet": escala uniforme — usar a maior das duas
		// para que dx/dy em pixels mapeiem para a mesma distância em coords SVG.
		const scale = Math.max(viewBox.width / rect.width, viewBox.height / rect.height);

		return {
			dx: (currentClientX - startClientX) * scale * DRAG_GAIN,
			dy: (currentClientY - startClientY) * scale * DRAG_GAIN
		};
	}

	function renderPopupContent(node, model, hostLevels, statusMap, trafficMap, speedMap, opts) {
		const neighbors = (model.adjacency[node] || []).slice().sort((a, b) => naturalCompare(a.peer, b.peer));
		const degree = model.degreeMap[node] || 0;
		const level = (hostLevels && Object.prototype.hasOwnProperty.call(hostLevels, node))
			? hostLevels[node]
			: null;
		opts = opts || {};
		const unmanagedSet = opts.unmanagedSet || new Set();
		const utilWarnPct = opts.utilWarnPct || 60;
		const utilCritPct = opts.utilCritPct || 85;
		const isUnmanaged = unmanagedSet.has(node);

		let tier = 'Borda';
		if (degree >= 4) tier = 'Core';
		else if (degree >= 2) tier = 'Distribuição';

		let html = '';
		html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
		html += '<div style="font-size:17px; font-weight:700;">' + esc(node) + '</div>';
		html += '<button type="button" class="topology-popup-close" style="background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px 8px;cursor:pointer;">Fechar</button>';
		html += '</div>';
		if (isUnmanaged) {
			html += '<div style="margin-bottom:8px; padding:6px 8px; background:#1e293b; border:1px dashed #94a3b8; border-radius:6px; color:#fbbf24;">'
				+ '⚠ Host descoberto via CDP/LLDP, mas <strong>não cadastrado</strong> no Zabbix.</div>';
		}
		html += '<div style="margin-bottom:8px;"><strong>Camada:</strong> ' + esc(tier) + '</div>';
		html += '<div style="margin-bottom:8px;"><strong>Grau:</strong> ' + degree + '</div>';
		html += '<div style="margin-bottom:12px;"><strong>Nível:</strong> '
			+ (level === null ? '—' : ('N' + level + (level === 0 ? ' (origem)' : '')))
			+ '</div>';
		html += '<div style="font-size:14px; font-weight:700; margin-bottom:8px;">Conexões</div>';
		html += '<div style="max-height:280px; overflow:auto; border-top:1px solid #1f2937; padding-top:8px;">';

		neighbors.forEach((n) => {
			const info = getStatusInfo(statusMap, n.statusHost, n.statusPort);
			const status = info ? info.status : null;
			const statusColor = status === 'up' ? '#22c55e' : status === 'down' ? '#ef4444' : '#94a3b8';
			const traffic = getTrafficInfo(trafficMap, n.statusHost, n.statusPort);
			const speed = getSpeedBps(speedMap, n.statusHost, n.statusPort);

			html += '<div style="padding:8px 0; border-bottom:1px solid #1f2937;">';
			html += '<div style="font-weight:600;">' + esc(n.peer)
				+ (unmanagedSet.has(n.peer) ? ' <span style="color:#fbbf24;">(?)</span>' : '') + '</div>';
			html += '<div style="font-size:12px; color:#cbd5e1;">Protocolo: ' + esc(n.protocol || '-') + '</div>';
			html += '<div style="font-size:12px; color:#cbd5e1;">Porta: ' + esc(n.port || '-') + '</div>';
			if (status) {
				html += '<div style="font-size:12px; color:' + statusColor + '; font-weight:600;">Status: ' + esc(status) + '</div>';
				if (info.rawIf) {
					html += '<div style="font-size:11px; color:#64748b;">Interface: ' + esc(info.rawIf) + '</div>';
				}
			}
			if (traffic && (typeof traffic.in === 'number' || typeof traffic.out === 'number')) {
				const inStr = typeof traffic.in === 'number' ? formatBps(traffic.in) : '-';
				const outStr = typeof traffic.out === 'number' ? formatBps(traffic.out) : '-';
				html += '<div style="font-size:12px; color:#a7f3d0; margin-top:2px;">'
					+ '↓ RX: ' + esc(inStr) + ' &nbsp; ↑ TX: ' + esc(outStr) + '</div>';
			}
			if (speed && traffic) {
				const peak = Math.max(
					typeof traffic.in === 'number' ? traffic.in : 0,
					typeof traffic.out === 'number' ? traffic.out : 0
				);
				const pct = (peak / speed) * 100;
				const utilColor = colorForUtilization(pct, utilWarnPct, utilCritPct);
				html += '<div style="font-size:12px; color:' + utilColor + '; font-weight:600; margin-top:2px;">'
					+ 'Util: ' + pct.toFixed(1) + '% '
					+ '<span style="color:#94a3b8; font-weight:400;">(' + esc(formatBps(speed)) + ')</span></div>';
			}
			html += '</div>';
		});

		html += '</div>';
		return html;
	}

	function showPopup(rootEl, popupEl, html, clientX, clientY) {
		const rootRect = rootEl.getBoundingClientRect();

		let left = clientX - rootRect.left + 12;
		let top = clientY - rootRect.top + 12;

		const popupWidth = 320;
		const popupHeight = 360;

		if (left + popupWidth > rootRect.width - 12) left = rootRect.width - popupWidth - 12;
		if (top + popupHeight > rootRect.height - 12) top = rootRect.height - popupHeight - 12;
		if (left < 12) left = 12;
		if (top < 12) top = 12;

		popupEl.innerHTML = html;
		popupEl.style.left = left + 'px';
		popupEl.style.top = top + 'px';
		popupEl.style.display = 'block';

		const closeBtn = popupEl.querySelector('.topology-popup-close');
		if (closeBtn) {
			closeBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				popupEl.style.display = 'none';
			});
		}
	}

	function hidePopup(popupEl) {
		if (popupEl) popupEl.style.display = 'none';
	}

	function buildAnchorOwnership(model, anchors) {
		const ownership = {};
		const anchorSet = new Set(anchors);

		anchors.forEach((a) => {
			ownership[a] = a;
		});

		// Conta quantos filhos diretos cada anchor já recebeu — usado como
		// desempate para filhos compartilhados (balancear carga visual).
		const ownerLoad = {};
		anchors.forEach((a) => { ownerLoad[a] = 0; });

		// Fallback (raro): só roda se o nó não tem NENHUM anchor como vizinho direto.
		function scoreNodeForAnchorIndirect(node, anchor) {
			let score = 0;
			const neighbors = model.adjacency[node] || [];
			neighbors.forEach((n) => {
				const secondHop = model.adjacency[n.peer] || [];
				secondHop.forEach((n2) => {
					if (n2.peer === anchor) score += 1;
				});
			});
			return score;
		}

		model.nodes.forEach((node) => {
			if (anchorSet.has(node)) return;

			// Anchors com conexão DIRETA ao nó.
			const neighbors = model.adjacency[node] || [];
			const directAnchors = [];
			const seen = {};
			neighbors.forEach((n) => {
				if (anchorSet.has(n.peer) && !seen[n.peer]) {
					seen[n.peer] = true;
					directAnchors.push(n.peer);
				}
			});

			if (directAnchors.length > 0) {
				// Desempate: anchor com menos filhos atribuídos até agora;
				// em caso de empate, ordem natural (determinístico).
				directAnchors.sort((a, b) => {
					if (ownerLoad[a] !== ownerLoad[b]) return ownerLoad[a] - ownerLoad[b];
					return naturalCompare(a, b);
				});
				const chosen = directAnchors[0];
				ownership[node] = chosen;
				ownerLoad[chosen] += 1;
				return;
			}

			// Sem nenhum anchor direto: usa heurística indireta (segundo-salto).
			let bestAnchor = null;
			let bestScore = 0;
			anchors.forEach((anchor) => {
				const score = scoreNodeForAnchorIndirect(node, anchor);
				if (score > bestScore) {
					bestScore = score;
					bestAnchor = anchor;
				}
			});

			if (bestAnchor) {
				ownership[node] = bestAnchor;
				ownerLoad[bestAnchor] += 1;
			}
		});

		return ownership;
	}

	function buildCollapsedVisibleGraph(model, anchors, ownership) {
		const visibleNodes = anchors.slice().sort(naturalCompare);
		const visibleLinks = [];
		const linkIndex = {};

		model.nodes.forEach((node) => {
			const neighbors = model.adjacency[node] || [];

			neighbors.forEach((n) => {
				const a = ownership[node];
				const b = ownership[n.peer];

				if (!a || !b) return;

				const source = a;
				const target = b;

				if (source === target) return;

				const pairKey = [source, target].sort(naturalCompare).join('|') + '|' + (n.protocol || '');
				const memberKey = (n.statusHost || '') + '|' + (n.statusPort || '');

				let entry = linkIndex[pairKey];
				if (!entry) {
					entry = {
						source: source,
						target: target,
						protocol: n.protocol || '',
						port: '',
						statusHost: '',
						statusPort: '',
						members: [],
						_seenMembers: {}
					};
					linkIndex[pairKey] = entry;
					visibleLinks.push(entry);
				}

				if (!entry._seenMembers[memberKey] && n.statusHost) {
					entry._seenMembers[memberKey] = true;
					entry.members.push({ statusHost: n.statusHost, statusPort: n.statusPort });
				}
			});
		});

		visibleLinks.forEach((l) => { delete l._seenMembers; });

		return { nodes: visibleNodes, links: visibleLinks };
	}

	function buildExpandedVisibleGraph(model, anchors, expandedState, ownership) {
		const visibleNodes = new Set();
		const visibleLinks = [];
		const linkIndex = {};

		anchors.forEach((a) => visibleNodes.add(a));

		model.nodes.forEach((node) => {
			const owner = ownership[node];
			if (!owner) return;

			if (node !== owner && expandedState[owner]) {
				visibleNodes.add(node);
			}
		});

		model.nodes.forEach((node) => {
			const neighbors = model.adjacency[node] || [];

			neighbors.forEach((n) => {
				const ownerA = ownership[node];
				const ownerB = ownership[n.peer];
				if (!ownerA || !ownerB) return;

				let source = node;
				let target = n.peer;

				if (node !== ownerA && !expandedState[ownerA]) {
					source = ownerA;
				}
				if (n.peer !== ownerB && !expandedState[ownerB]) {
					target = ownerB;
				}

				if (source === target) return;
				if (!visibleNodes.has(source) || !visibleNodes.has(target)) return;

				const isAgg = source === ownerA && target === ownerB;
				const pairKey = [source, target].sort(naturalCompare).join('|') + '|' + (n.protocol || '') + '|' + (isAgg ? 'agg' : (n.port || ''));
				const memberKey = (n.statusHost || '') + '|' + (n.statusPort || '');

				let entry = linkIndex[pairKey];
				if (!entry) {
					entry = {
						source: source,
						target: target,
						protocol: n.protocol || '',
						port: isAgg ? '' : (n.port || ''),
						statusHost: isAgg ? '' : (n.statusHost || ''),
						statusPort: isAgg ? '' : (n.statusPort || ''),
						members: [],
						_seenMembers: {}
					};
					linkIndex[pairKey] = entry;
					visibleLinks.push(entry);
				}

				if (!entry._seenMembers[memberKey] && n.statusHost) {
					entry._seenMembers[memberKey] = true;
					entry.members.push({ statusHost: n.statusHost, statusPort: n.statusPort });
				}
			});
		});

		visibleLinks.forEach((l) => { delete l._seenMembers; });

		return {
			nodes: Array.from(visibleNodes).sort(naturalCompare),
			links: visibleLinks
		};
	}

	function layoutCollapsedAnchors(anchors, width, height) {
		const positions = {};
		const groupedAnchors = groupAnchorsBySimilarity(anchors);
		const orderedAnchors = [];
		groupedAnchors.forEach((group) => {
			group.anchors.forEach((anchor) => orderedAnchors.push(anchor));
		});

		const centerX = width / 2;
		const centerY = height * 0.53;
		const radiusX = Math.min(430, Math.max(240, width * 0.24));
		const radiusY = Math.min(260, Math.max(150, height * 0.18));

		if (orderedAnchors.length === 1) {
			positions[orderedAnchors[0]] = { x: centerX, y: centerY };
			return positions;
		}

		const groupGapUnits = 0.9;
		let totalUnits = 0;

		groupedAnchors.forEach((group, index) => {
			totalUnits += group.anchors.length;
			if (index < groupedAnchors.length - 1) totalUnits += groupGapUnits;
		});

		let cursor = 0;
		const startAngle = -Math.PI / 2;

		groupedAnchors.forEach((group, groupIndex) => {
			group.anchors.forEach((anchor) => {
				const angle = startAngle + ((cursor / totalUnits) * Math.PI * 2);
				positions[anchor] = {
					x: centerX + Math.cos(angle) * radiusX,
					y: centerY + Math.sin(angle) * radiusY
				};
				cursor += 1;
			});

			if (groupIndex < groupedAnchors.length - 1) cursor += groupGapUnits;
		});

		return positions;
	}

	function layoutExpandedGraph(model, anchors, expandedState, ownership, width, height, savedPositions) {
		const positions = layoutCollapsedAnchors(anchors, width, height);
		const centerX = width / 2;
		const centerY = height * 0.53;
		const anchorSet = new Set(anchors);

		// Aplica savedPositions nos próprios CORES antes de posicionar filhos:
		// assim, ao expandir um core que foi arrastado, os filhos seguem o pai.
		if (savedPositions) {
			anchors.forEach((anchor) => {
				if (savedPositions[anchor]) {
					positions[anchor] = {
						x: savedPositions[anchor].x,
						y: savedPositions[anchor].y
					};
				}
			});
		}

		// Coloca filhos em leque a partir de uma posição base, em chunks concêntricos.
		function placeFan(children, anchorPos, baseAngle, maxSpreadDeg, chunkSize, baseRadius, radiusStep) {
			if (!children.length) return;
			maxSpreadDeg = maxSpreadDeg || 165;
			chunkSize    = chunkSize    || 10;
			baseRadius   = baseRadius   || 170;
			radiusStep   = radiusStep   || 80;

			for (let i = 0; i < children.length; i += chunkSize) {
				const chunk = children.slice(i, i + chunkSize);
				const radius = baseRadius + (Math.floor(i / chunkSize) * radiusStep);
				const spreadDeg = Math.min(maxSpreadDeg, 50 + (chunk.length * 7));
				const halfSpread = (spreadDeg / 2) * Math.PI / 180;

				if (chunk.length === 1) {
					positions[chunk[0]] = {
						x: anchorPos.x + Math.cos(baseAngle) * radius,
						y: anchorPos.y + Math.sin(baseAngle) * radius
					};
				}
				else {
					chunk.forEach((node, idx) => {
						const t = idx / (chunk.length - 1);
						const ang = baseAngle - halfSpread + ((halfSpread * 2) * t);
						positions[node] = {
							x: anchorPos.x + Math.cos(ang) * radius,
							y: anchorPos.y + Math.sin(ang) * radius
						};
					});
				}
			}
		}

		anchors.forEach((anchor) => {
			if (!expandedState[anchor]) return;

			const anchorPos = positions[anchor];
			const owned = model.nodes
				.filter((n) => n !== anchor && ownership[n] === anchor)
				.sort((a, b) => {
					const da = model.degreeMap[a] || 0;
					const db = model.degreeMap[b] || 0;
					if (db !== da) return db - da;
					return naturalCompare(a, b);
				});

			// Classifica cada filho:
			//  - "puro": só conecta com o anchor dono → vai no leque para fora
			//  - "compartilhado": também conecta com OUTRO anchor → fica entre os dois
			//    (assim a linha para cada CORE fica curta, sem cruzar a tela)
			const purelyOwned = [];
			const sharedByOther = {}; // otherAnchor → [filhos]

			owned.forEach((child) => {
				const peers = (model.adjacency[child] || []).map((p) => p.peer);
				const otherAnchors = peers.filter((p) => p !== anchor && anchorSet.has(p));

				if (otherAnchors.length === 0) {
					purelyOwned.push(child);
				}
				else {
					// Determinístico: atribui ao "primeiro" outro anchor (ordem natural).
					otherAnchors.sort(naturalCompare);
					const primary = otherAnchors[0];
					if (!sharedByOther[primary]) sharedByOther[primary] = [];
					sharedByOther[primary].push(child);
				}
			});

			// Filhos puros: leque para fora do centro (comportamento original).
			const dx = anchorPos.x - centerX;
			const dy = anchorPos.y - centerY;
			const outwardAngle = Math.atan2(dy, dx);
			placeFan(purelyOwned, anchorPos, outwardAngle);

			// Filhos compartilhados: leque estreito direcionado ao outro anchor,
			// com raio menor para que fiquem posicionados ENTRE os dois COREs.
			Object.keys(sharedByOther).forEach((other) => {
				const otherPos = positions[other];
				if (!otherPos) return;

				const ddx = otherPos.x - anchorPos.x;
				const ddy = otherPos.y - anchorPos.y;
				const distToOther = Math.hypot(ddx, ddy) || 1;
				const angleToOther = Math.atan2(ddy, ddx);

				// Raio base ≈ 35% do caminho até o outro CORE, limitado.
				const baseR = Math.max(140, Math.min(distToOther * 0.35, 260));
				// Leque mais estreito (60°) pra não esbarrar nos filhos puros.
				placeFan(sharedByOther[other], anchorPos, angleToOther, 60, 8, baseR, 70);
			});
		});

		return positions;
	}

	function buildMoveGroup(model, startNode, anchorSet, visibleNodesSet, ownership, savedPositions) {
		const visited = new Set();
		const moveSet = new Set();

		function walk(node) {
			if (visited.has(node)) return;
			if (!visibleNodesSet.has(node)) return;

			visited.add(node);
			moveSet.add(node);

			const nodeDegree = model.degreeMap[node] || 0;
			const neighbors = model.adjacency[node] || [];

			neighbors.forEach((n) => {
				const peer = n.peer;
				const peerDegree = model.degreeMap[peer] || 0;
				const peerIsAnchor = anchorSet.has(normalizeName(peer));

				if (!visibleNodesSet.has(peer)) return;
				if (peerIsAnchor && peer !== startNode) return;

				if (peerDegree <= nodeDegree) {
					walk(peer);
				}
			});
		}

		walk(startNode);

		// Se o startNode é um CORE colapsado, também leve junto os filhos
		// "escondidos" que já têm posição salva (foram arrastados antes).
		// Filhos sem savedPosition seguem naturalmente via layoutExpandedGraph
		// porque o anchor agora carrega suas posições.
		if (anchorSet && anchorSet.has(startNode) && ownership && savedPositions) {
			(model.nodes || []).forEach((n) => {
				if (n === startNode) return;
				if (anchorSet.has(n)) return;
				if (ownership[n] !== startNode) return;
				if (!savedPositions[n]) return;
				moveSet.add(n);
			});
		}

		return Array.from(moveSet);
	}

	function scanAndRender() {
		document.querySelectorAll('.topology-test-widget').forEach((rootEl) => {
			if (rootEl.dataset.initialized === '1') return;

			const graphEl = rootEl.querySelector('.topology-test-graph');
			const popupEl = rootEl.querySelector('.topology-test-popup');
			const clearFocusBtn = rootEl.querySelector('.topology-clear-focus-btn');
			const resetLayoutBtn = rootEl.querySelector('.topology-reset-layout-btn');

			if (!graphEl || !popupEl || !clearFocusBtn) return;

			rootEl.dataset.initialized = '1';

			let links = [];
			let hostLevels = {};
			let interfaceStatuses = [];
			let interfaceTraffic = [];
			let interfaceSpeed = [];
			let unmanagedNodes = [];
			let widgetConfig = {};

			try {
				links = JSON.parse(atob(rootEl.dataset.links || ''));
			}
			catch (e) {
				graphEl.innerHTML = '<div style="padding:16px;color:#fff;">Erro ao ler os links da topologia.</div>';
				return;
			}

			try {
				const raw = JSON.parse(atob(rootEl.dataset.hostLevels || ''));
				if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
					hostLevels = raw;
				}
			}
			catch (e) {
				hostLevels = {};
			}

			try {
				interfaceStatuses = JSON.parse(atob(rootEl.dataset.interfaceStatuses || ''));
			}
			catch (e) {
				interfaceStatuses = [];
			}

			try {
				interfaceTraffic = JSON.parse(atob(rootEl.dataset.interfaceTraffic || ''));
			}
			catch (e) {
				interfaceTraffic = [];
			}

			try {
				interfaceSpeed = JSON.parse(atob(rootEl.dataset.interfaceSpeed || ''));
			}
			catch (e) {
				interfaceSpeed = [];
			}

			try {
				unmanagedNodes = JSON.parse(atob(rootEl.dataset.unmanagedNodes || ''));
			}
			catch (e) {
				unmanagedNodes = [];
			}

			try {
				widgetConfig = JSON.parse(atob(rootEl.dataset.widgetConfig || ''));
			}
			catch (e) {
				widgetConfig = {};
			}

			const showUnmanagedMode = parseInt(widgetConfig.show_unmanaged, 10) || 0; // 0=todos,1=monitorados,2=não-monit
			const utilWarnPct      = parseInt(widgetConfig.util_warn_pct, 10) || 60;
			const utilCritPct      = parseInt(widgetConfig.util_crit_pct, 10) || 85;

			const unmanagedSet = new Set((unmanagedNodes || []).map((n) => normalizeName(n)));

			// Aplica filtro de exibição (somente monitorados / somente não-monitorados)
			if (showUnmanagedMode === 1) {
				links = (links || []).filter((l) =>
					!unmanagedSet.has(normalizeName(l.source)) &&
					!unmanagedSet.has(normalizeName(l.target))
				);
			}
			else if (showUnmanagedMode === 2) {
				links = (links || []).filter((l) =>
					unmanagedSet.has(normalizeName(l.source)) ||
					unmanagedSet.has(normalizeName(l.target))
				);
			}

			const statusMap = buildStatusMap(interfaceStatuses);
			const trafficMap = buildTrafficMap(interfaceTraffic);
			const speedMap = buildSpeedMap(interfaceSpeed);
			const model = buildModel(links);

			// Hosts do grupo selecionado = nível 0 → âncoras (cores) do mapa.
			// Eles SEMPRE aparecem, mesmo que ainda não tenham vizinhos descobertos.
			const nodesInModel = new Set(model.nodes);
			Object.keys(hostLevels).forEach((n) => {
				if (hostLevels[n] === 0 && !nodesInModel.has(n)) {
					model.nodes.push(n);
					nodesInModel.add(n);
					if (!model.adjacency[n]) model.adjacency[n] = [];
					if (!model.degreeMap[n]) model.degreeMap[n] = 0;
				}
			});
			model.nodes.sort(naturalCompare);

			const lvl0Anchors = Object.keys(hostLevels)
				.filter((n) => hostLevels[n] === 0 && nodesInModel.has(n));

			const anchors = lvl0Anchors.length
				? lvl0Anchors
				: model.nodes.filter((n) => (model.degreeMap[n] || 0) >= 4);
			const storageKey = getStorageKey(rootEl, anchors);
			const savedPositions = loadSavedPositions(storageKey);
			const expandedState = loadExpandedState(storageKey);
			const ownership = buildAnchorOwnership(model, anchors);

			let selectedNode = rootEl.dataset.selectedNode || '';
			let suppressClickUntil = 0;
			let framePending = false;
			let dragState = null;

			// Estado do viewBox (pan & zoom). Persistido por widget/grupo.
			const VIEW_W = 1800, VIEW_H = 1100;
			const viewKey = storageKey + ':viewbox';
			let viewBox = (function () {
				try {
					const raw = localStorage.getItem(viewKey);
					if (raw) {
						const parsed = JSON.parse(raw);
						if (parsed && typeof parsed.x === 'number') return parsed;
					}
				}
				catch (e) {}
				return { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
			})();

			function saveViewBox() {
				try { localStorage.setItem(viewKey, JSON.stringify(viewBox)); } catch (e) {}
			}

			function setSvgViewBox() {
				const svgEl = graphEl.querySelector('svg');
				if (svgEl) {
					svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
				}
			}

			anchors.forEach((a) => {
				if (typeof expandedState[a] === 'undefined') expandedState[a] = false;
			});

			function clearFocus() {
				hidePopup(popupEl);
				selectedNode = '';
				rootEl.dataset.selectedNode = '';
				clearFocusBtn.style.display = 'none';
				scheduleDraw();
			}

			function scheduleDraw() {
				if (framePending) return;
				framePending = true;
				window.requestAnimationFrame(() => {
					framePending = false;
					draw();
				});
			}

			// Atualiza apenas os atributos SVG dos elementos afetados pelo drag,
			// sem regerar todo o innerHTML. Usado em pointermove para drag fluido.
			function applyDragVisualUpdate(moveNodes) {
				if (!moveNodes || !moveNodes.length) return;
				const moveSet = new Set(moveNodes);

				moveNodes.forEach((node) => {
					const pos = savedPositions[node];
					if (!pos) return;

					const g = graphEl.querySelector('.topology-node[data-node="' + (window.CSS && CSS.escape ? CSS.escape(node) : node.replace(/"/g, '\\"')) + '"]');
					if (!g) return;

					const circle = g.querySelector('.topology-node-circle');
					const halo = g.querySelector('.topology-node-halo');
					const letter = g.querySelector('.topology-node-letter');
					const label = g.querySelector('.topology-node-label');

					if (circle) {
						circle.setAttribute('cx', pos.x);
						circle.setAttribute('cy', pos.y);
					}
					if (halo) {
						halo.setAttribute('cx', pos.x);
						halo.setAttribute('cy', pos.y);
					}
					if (letter) {
						letter.setAttribute('x', pos.x);
						letter.setAttribute('y', pos.y + 4);
					}
					if (label) {
						const r = parseFloat(label.getAttribute('data-radius')) || 19;
						label.setAttribute('x', pos.x);
						label.setAttribute('y', pos.y + r + 18);
					}

					const toggle = g.querySelector('.topology-toggle');
					if (toggle) {
						const r = parseFloat(toggle.getAttribute('data-radius')) || 30;
						const tCircle = toggle.querySelector('.topology-toggle-circle');
						const tText = toggle.querySelector('.topology-toggle-text');
						if (tCircle) {
							tCircle.setAttribute('cx', pos.x + r - 2);
							tCircle.setAttribute('cy', pos.y - r + 2);
						}
						if (tText) {
							tText.setAttribute('x', pos.x + r - 2);
							tText.setAttribute('y', pos.y - r + 6);
						}
					}
				});

				// Atualiza endpoints das linhas que tocam algum nó movido
				const lines = graphEl.querySelectorAll('.topology-link-line, .topology-link-hit');
				lines.forEach((line) => {
					const src = line.getAttribute('data-src');
					const tgt = line.getAttribute('data-tgt');
					if (moveSet.has(src)) {
						const p = savedPositions[src];
						if (p) {
							line.setAttribute('x1', p.x);
							line.setAttribute('y1', p.y);
						}
					}
					if (moveSet.has(tgt)) {
						const p = savedPositions[tgt];
						if (p) {
							line.setAttribute('x2', p.x);
							line.setAttribute('y2', p.y);
						}
					}
				});
			}

			function draw() {
				const width = 1800;
				const height = 1100;

				const anyExpanded = anchors.some((a) => expandedState[a]);
				const visible = anyExpanded
					? buildExpandedVisibleGraph(model, anchors, expandedState, ownership)
					: buildCollapsedVisibleGraph(model, anchors, ownership);

				const positions = anyExpanded
					? layoutExpandedGraph(model, anchors, expandedState, ownership, width, height, savedPositions)
					: layoutCollapsedAnchors(anchors, width, height);

				Object.keys(savedPositions).forEach((node) => {
					if (positions[node]) {
						positions[node] = {
							x: savedPositions[node].x,
							y: savedPositions[node].y
						};
					}
				});

				const visibleNodesSet = new Set(visible.nodes);
				const anchorSet = new Set(anchors);

				clearFocusBtn.style.display = selectedNode ? 'block' : 'none';

				let svg = '';
				svg += '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" '
					+ 'viewBox="' + viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h + '" '
					+ 'preserveAspectRatio="xMidYMid meet" '
					+ 'style="display:block; width:100%; height:100%; user-select:none;">';
				svg += '<rect class="topology-bg" x="-100000" y="-100000" width="200000" height="200000" fill="#0f172a" pointer-events="all"/>';

				visible.links.forEach((link, linkIdx) => {
					const s = link.source;
					const t = link.target;

					if (!positions[s] || !positions[t]) return;

					const active = !selectedNode || s === selectedNode || t === selectedNode;

					// Status agregado (UP / DOWN / null)
					let aggStatus = aggregateMembersStatus(statusMap, link.members);
					if (!aggStatus && link.statusHost) {
						const sInfo = getStatusInfo(statusMap, link.statusHost, link.statusPort);
						if (sInfo) aggStatus = sInfo.status;
					}

					// Utilização agregada (worst case entre membros)
					const util = aggregateMembersUtilization(trafficMap, speedMap, link.members);

					// Lógica COMBINADA de cor:
					//   DOWN  → vermelho TRACEJADO (perda total da porta)
					//   UP    → cor por utilização (verde / amarelo / vermelho conforme thresholds)
					//   demais → cor padrão por protocolo (CDP=azul, LLDP=verde-água tracejado)
					let color = '#60a5fa';                                             // CDP padrão
					let dashAttr = '';
					if (String(link.protocol || '').toUpperCase() === 'LLDP') {
						color = '#34d399';
						dashAttr = ' stroke-dasharray="6 3" ';
					}

					if (aggStatus === 'down') {
						color = '#ef4444';
						dashAttr = ' stroke-dasharray="8 4" ';
					}
					else if (aggStatus === 'up') {
						if (util) {
							color = colorForUtilization(util.pct, utilWarnPct, utilCritPct);
						}
						else {
							color = '#22c55e';
						}
						// Em UP, sobrescreve dash do LLDP por linha sólida (cor já carrega o estado)
						dashAttr = '';
					}

					const opacity = active ? 0.92 : 0.2;

					// Espessura: base + leve aumento conforme utilização (escala log).
					let strokeWidth = active ? 2.6 : 1.2;
					if (util) {
						strokeWidth = strokeForUtilization(util.pct);
						if (!active) strokeWidth = Math.max(1.2, strokeWidth * 0.5);
					}

					const x1 = positions[s].x, y1 = positions[s].y;
					const x2 = positions[t].x, y2 = positions[t].y;

					// Linha visível
					svg += '<line class="topology-link-line" '
						+ 'data-src="' + esc(s) + '" data-tgt="' + esc(t) + '" '
						+ 'x1="' + x1 + '" y1="' + y1 + '" '
						+ 'x2="' + x2 + '" y2="' + y2 + '" '
						+ 'stroke="' + color + '" '
						+ 'stroke-width="' + strokeWidth + '" '
						+ 'opacity="' + opacity + '" '
						+ dashAttr
						+ 'pointer-events="none" />';

					// Hit-line invisível (mais larga) para facilitar o hover
					svg += '<line class="topology-link-hit" '
						+ 'data-link-idx="' + linkIdx + '" '
						+ 'data-src="' + esc(s) + '" data-tgt="' + esc(t) + '" '
						+ 'x1="' + x1 + '" y1="' + y1 + '" '
						+ 'x2="' + x2 + '" y2="' + y2 + '" '
						+ 'stroke="#000000" stroke-opacity="0" stroke-width="14" '
						+ 'pointer-events="stroke" style="cursor:help;" />';
				});

				visible.nodes.forEach((node) => {
					if (!positions[node]) return;

					const isCentral = anchorSet.has(node);
					const isExpanded = !!expandedState[node];
					const isSelected = selectedNode === node;
					const isNeighbor = selectedNode && (model.adjacency[selectedNode] || []).some((n) => n.peer === node);
					const isUnmanaged = unmanagedSet.has(node);
					const level = (hostLevels && Object.prototype.hasOwnProperty.call(hostLevels, node))
						? hostLevels[node] : null;

					// Cor de preenchimento base por nível (origem mais saturada, vai esmaecendo)
					const levelFills = ['#2563eb', '#0891b2', '#7c3aed', '#475569', '#334155', '#1e293b'];
					let fill;
					if (isCentral) {
						fill = levelFills[0];
					}
					else if (level !== null && level >= 1) {
						fill = levelFills[Math.min(level, levelFills.length - 1)];
					}
					else {
						fill = '#475569';
					}
					if (isUnmanaged) fill = '#1f2937';

					let radius = isCentral ? 30 : 19;

					let nodeOpacity = 1;
					if (selectedNode && !isSelected && !isNeighbor) nodeOpacity = 0.25;

					let stroke = isCentral ? '#fbbf24' : '#ffffff';
					let strokeWidth = isCentral ? 3 : 2;
					let strokeDash = '';

					if (isUnmanaged) {
						stroke = '#94a3b8';
						strokeWidth = 2;
						strokeDash = ' stroke-dasharray="4 3" ';
					}

					if (isSelected) {
						stroke = '#facc15';
						strokeWidth = 5;
						strokeDash = '';
					}

					const x = positions[node].x;
					const y = positions[node].y;
					const letter = isUnmanaged ? '?' : (isCentral ? 'C' : 'R');

					svg += '<g class="topology-node" data-node="' + esc(node) + '" data-unmanaged="' + (isUnmanaged ? '1' : '0') + '" style="cursor:grab;">';

					// Halo (anel externo) para destacar nós CORE (hosts do grupo selecionado)
					if (isCentral && !isUnmanaged) {
						svg += '<circle class="topology-node-halo" cx="' + x + '" cy="' + y + '" r="' + (radius + 6) + '" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="' + (nodeOpacity * 0.45) + '"/>';
					}

					svg += '<circle class="topology-node-circle" cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + strokeDash + ' opacity="' + nodeOpacity + '"/>';
					svg += '<text class="topology-node-letter" x="' + x + '" y="' + (y + 4) + '" fill="#ffffff" font-size="' + (isCentral ? 13 : 11) + '" font-weight="700" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">' + letter + '</text>';
					svg += '<text class="topology-node-label" data-radius="' + radius + '" x="' + x + '" y="' + (y + radius + 18) + '" fill="' + (isUnmanaged ? '#94a3b8' : (isCentral ? '#fde68a' : '#e2e8f0')) + '" font-size="' + (isCentral ? 12 : 11) + '" font-weight="' + (isCentral ? '700' : '400') + '" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">' + esc(shortName(node, 16)) + (isUnmanaged ? ' (?)' : '') + '</text>';

					if (isCentral) {
						const symbol = isExpanded ? '−' : '+';
						svg += '<g class="topology-toggle" data-node="' + esc(node) + '" data-radius="' + radius + '" style="cursor:pointer;">';
						svg += '<circle class="topology-toggle-circle" cx="' + (x + radius - 2) + '" cy="' + (y - radius + 2) + '" r="11" fill="#111827" stroke="#94a3b8" stroke-width="1.5"/>';
						svg += '<text class="topology-toggle-text" x="' + (x + radius - 2) + '" y="' + (y - radius + 6) + '" fill="#f8fafc" font-size="14" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700">' + symbol + '</text>';
						svg += '</g>';
					}

					svg += '</g>';
				});

				// Legenda discreta no canto inferior direito
				const legendW = 240;
				const legendH = 84;
				const legendX = 1800 - legendW - 10;
				const legendY = 1100 - legendH - 10;
				svg += '<g class="topology-legend" pointer-events="none" font-family="Arial, sans-serif">';
				svg += '<rect x="' + legendX + '" y="' + legendY + '" width="' + legendW + '" height="' + legendH + '" rx="6" ry="6" '
					+ 'fill="#0b1220" stroke="#334155" stroke-width="1" opacity="0.92"/>';
				svg += '<text x="' + (legendX + 10) + '" y="' + (legendY + 16) + '" fill="#e2e8f0" font-size="11" font-weight="700">Linhas</text>';
				// UP por utilização
				svg += '<line x1="' + (legendX + 10) + '" y1="' + (legendY + 30) + '" x2="' + (legendX + 30) + '" y2="' + (legendY + 30) + '" stroke="#22c55e" stroke-width="3"/>';
				svg += '<text x="' + (legendX + 36) + '" y="' + (legendY + 33) + '" fill="#cbd5e1" font-size="10">UP &lt; ' + utilWarnPct + '%</text>';
				svg += '<line x1="' + (legendX + 110) + '" y1="' + (legendY + 30) + '" x2="' + (legendX + 130) + '" y2="' + (legendY + 30) + '" stroke="#facc15" stroke-width="3"/>';
				svg += '<text x="' + (legendX + 136) + '" y="' + (legendY + 33) + '" fill="#cbd5e1" font-size="10">' + utilWarnPct + '–' + utilCritPct + '%</text>';
				svg += '<line x1="' + (legendX + 10) + '" y1="' + (legendY + 46) + '" x2="' + (legendX + 30) + '" y2="' + (legendY + 46) + '" stroke="#ef4444" stroke-width="3"/>';
				svg += '<text x="' + (legendX + 36) + '" y="' + (legendY + 49) + '" fill="#cbd5e1" font-size="10">≥ ' + utilCritPct + '%</text>';
				svg += '<line x1="' + (legendX + 110) + '" y1="' + (legendY + 46) + '" x2="' + (legendX + 130) + '" y2="' + (legendY + 46) + '" stroke="#ef4444" stroke-width="3" stroke-dasharray="6 4"/>';
				svg += '<text x="' + (legendX + 136) + '" y="' + (legendY + 49) + '" fill="#cbd5e1" font-size="10">DOWN</text>';
				// Não cadastrado
				svg += '<circle cx="' + (legendX + 18) + '" cy="' + (legendY + 68) + '" r="7" fill="#1f2937" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="3 2"/>';
				svg += '<text x="' + (legendX + 18) + '" y="' + (legendY + 71) + '" fill="#fbbf24" font-size="9" font-weight="700" text-anchor="middle">?</text>';
				svg += '<text x="' + (legendX + 32) + '" y="' + (legendY + 71) + '" fill="#cbd5e1" font-size="10">Host não cadastrado</text>';
				svg += '</g>';

				svg += '</svg>';

				graphEl.innerHTML = svg;

				const svgEl = graphEl.querySelector('svg');
				if (!svgEl) return;

				// ---------- PAN & ZOOM (viewBox) ----------
				// Helper: converte coords da tela em coords SVG considerando viewBox atual.
				function screenToSvg(clientX, clientY) {
					const rect = svgEl.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) {
						return { x: viewBox.x, y: viewBox.y };
					}
					// preserveAspectRatio="xMidYMid meet" → escala uniforme com letterbox
					const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
					const renderedW = viewBox.w * scale;
					const renderedH = viewBox.h * scale;
					const offsetX = (rect.width - renderedW) / 2;
					const offsetY = (rect.height - renderedH) / 2;
					const px = clientX - rect.left - offsetX;
					const py = clientY - rect.top - offsetY;
					return { x: viewBox.x + px / scale, y: viewBox.y + py / scale };
				}

				svgEl.addEventListener('wheel', function (event) {
					event.preventDefault();
					const factor = event.deltaY < 0 ? (1 / 1.15) : 1.15;
					const newW = Math.max(200, Math.min(VIEW_W * 6, viewBox.w * factor));
					const newH = Math.max(200, Math.min(VIEW_H * 6, viewBox.h * factor));
					const point = screenToSvg(event.clientX, event.clientY);
					const ratioX = (point.x - viewBox.x) / viewBox.w;
					const ratioY = (point.y - viewBox.y) / viewBox.h;
					viewBox = {
						x: point.x - ratioX * newW,
						y: point.y - ratioY * newH,
						w: newW,
						h: newH
					};
					setSvgViewBox();
					saveViewBox();
				}, { passive: false });

				// Pan: pointerdown no fundo (rect topology-bg), arrasta a viewBox.
				let panState = null;
				svgEl.addEventListener('pointerdown', function (event) {
					if (!event.target || !event.target.classList.contains('topology-bg')) return;
					event.preventDefault();
					const start = screenToSvg(event.clientX, event.clientY);
					panState = {
						pointerId: event.pointerId,
						startClientX: event.clientX,
						startClientY: event.clientY,
						originVB: { x: viewBox.x, y: viewBox.y },
						startPoint: start
					};
					try { svgEl.setPointerCapture(event.pointerId); } catch (e) {}
					svgEl.style.cursor = 'grabbing';
				});
				svgEl.addEventListener('pointermove', function (event) {
					if (!panState || panState.pointerId !== event.pointerId) return;
					const rect = svgEl.getBoundingClientRect();
					const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
					if (!scale) return;
					viewBox.x = panState.originVB.x - (event.clientX - panState.startClientX) / scale;
					viewBox.y = panState.originVB.y - (event.clientY - panState.startClientY) / scale;
					if (Math.abs(event.clientX - panState.startClientX) > 2
					 || Math.abs(event.clientY - panState.startClientY) > 2) {
						panState.moved = true;
					}
					setSvgViewBox();
				});
				function endPan(event) {
					if (!panState || panState.pointerId !== event.pointerId) return;
					try { svgEl.releasePointerCapture(event.pointerId); } catch (e) {}
					svgEl.style.cursor = '';
					if (panState.moved) suppressClickUntil = Date.now() + 220;
					panState = null;
					saveViewBox();
				}
				svgEl.addEventListener('pointerup', endPan);
				svgEl.addEventListener('pointercancel', endPan);
				// ---------- /PAN & ZOOM ----------

				// Tooltip de hover (criado uma única vez por widget)
				let tooltipEl = rootEl.querySelector('.topology-link-tooltip');
				if (!tooltipEl) {
					tooltipEl = document.createElement('div');
					tooltipEl.className = 'topology-link-tooltip';
					tooltipEl.style.cssText = 'display:none; position:absolute; z-index:40; pointer-events:none; '
						+ 'background:#0b1220; color:#e5e7eb; border:1px solid #334155; border-radius:6px; '
						+ 'padding:6px 9px; font-size:12px; font-family:Arial, sans-serif; '
						+ 'box-shadow:0 6px 16px rgba(0,0,0,0.4); max-width:340px; line-height:1.45;';
					rootEl.appendChild(tooltipEl);
				}

				function hideLinkTooltip() {
					tooltipEl.style.display = 'none';
				}

				function showLinkTooltipFor(linkIdx, clientX, clientY) {
					const link = visible.links[linkIdx];
					if (!link) return;

					const status = aggregateMembersStatus(statusMap, link.members)
						|| (link.statusHost ? (getStatusInfo(statusMap, link.statusHost, link.statusPort) || {}).status : null)
						|| 'desconhecido';
					const statusColor = status === 'up' ? '#22c55e' : status === 'down' ? '#ef4444' : '#94a3b8';

					let traffic = aggregateMembersTraffic(trafficMap, link.members);
					if (!traffic && link.statusHost) {
						const t = getTrafficInfo(trafficMap, link.statusHost, link.statusPort);
						if (t) traffic = { in: typeof t.in === 'number' ? t.in : null, out: typeof t.out === 'number' ? t.out : null };
					}

					const util = aggregateMembersUtilization(trafficMap, speedMap, link.members);

					const memberCount = (link.members && link.members.length) || 0;
					const aggregated = memberCount > 1;

					let html = '';
					html += '<div style="font-weight:700; margin-bottom:4px;">'
						+ esc(link.source) + ' ↔ ' + esc(link.target) + '</div>';
					html += '<div style="color:#cbd5e1;">Protocolo: ' + esc(link.protocol || '-') + '</div>';
					if (link.port) {
						html += '<div style="color:#cbd5e1;">Porta: ' + esc(link.port) + '</div>';
					}
					html += '<div style="color:' + statusColor + '; font-weight:600;">'
						+ 'Status: ' + esc(status) + (aggregated ? ' (' + memberCount + ' enlaces)' : '') + '</div>';

					if (traffic && (typeof traffic.in === 'number' || typeof traffic.out === 'number')) {
						const inStr = typeof traffic.in === 'number' ? formatBps(traffic.in) : '-';
						const outStr = typeof traffic.out === 'number' ? formatBps(traffic.out) : '-';
						html += '<div style="margin-top:4px; color:#a7f3d0;">'
							+ '↓ RX: ' + esc(inStr) + ' &nbsp; ↑ TX: ' + esc(outStr) + '</div>';
					}
					else {
						html += '<div style="margin-top:4px; color:#94a3b8;">Sem dados de tráfego</div>';
					}

					if (util) {
						const utilColor = colorForUtilization(util.pct, utilWarnPct, utilCritPct);
						html += '<div style="margin-top:2px; color:' + utilColor + '; font-weight:600;">'
							+ 'Utilização: ' + util.pct.toFixed(1) + '% '
							+ '<span style="color:#94a3b8; font-weight:400;">('
							+ esc(formatBps(util.peakBps)) + ' / ' + esc(formatBps(util.speedBps)) + ')</span></div>';
					}

					tooltipEl.innerHTML = html;
					tooltipEl.style.display = 'block';

					const rootRect = rootEl.getBoundingClientRect();
					const tipRect = tooltipEl.getBoundingClientRect();
					let left = clientX - rootRect.left + 14;
					let top = clientY - rootRect.top + 14;
					if (left + tipRect.width > rootRect.width - 8) left = rootRect.width - tipRect.width - 8;
					if (top + tipRect.height > rootRect.height - 8) top = rootRect.height - tipRect.height - 8;
					if (left < 8) left = 8;
					if (top < 8) top = 8;
					tooltipEl.style.left = left + 'px';
					tooltipEl.style.top = top + 'px';
				}

				graphEl.querySelectorAll('.topology-link-hit').forEach((el) => {
					el.addEventListener('mouseenter', function (event) {
						const idx = parseInt(this.dataset.linkIdx, 10);
						if (isNaN(idx)) return;
						showLinkTooltipFor(idx, event.clientX, event.clientY);
					});
					el.addEventListener('mousemove', function (event) {
						if (tooltipEl.style.display !== 'block') return;
						const rootRect = rootEl.getBoundingClientRect();
						const tipRect = tooltipEl.getBoundingClientRect();
						let left = event.clientX - rootRect.left + 14;
						let top = event.clientY - rootRect.top + 14;
						if (left + tipRect.width > rootRect.width - 8) left = rootRect.width - tipRect.width - 8;
						if (top + tipRect.height > rootRect.height - 8) top = rootRect.height - tipRect.height - 8;
						if (left < 8) left = 8;
						if (top < 8) top = 8;
						tooltipEl.style.left = left + 'px';
						tooltipEl.style.top = top + 'px';
					});
					el.addEventListener('mouseleave', function () {
						hideLinkTooltip();
					});
				});

				// NOTE: o handler do toggle (.topology-toggle) NÃO é mais anexado por elemento aqui.
				// Foi movido para event-delegation em `graphEl` (anexado uma única vez fora de draw()),
				// para evitar qualquer ambiguidade de hit-test/closure entre redraws.

				graphEl.querySelectorAll('.topology-node').forEach((el) => {
					el.addEventListener('pointerdown', function (event) {
						const node = this.dataset.node || '';
						if (!node || !positions[node]) return;

						if (event.target && event.target.closest && event.target.closest('.topology-toggle')) {
							return;
						}

						event.preventDefault();
						event.stopPropagation();
						hidePopup(popupEl);

						const moveNodes = buildMoveGroup(model, node, anchorSet, visibleNodesSet, ownership, savedPositions);
						const originPositions = {};

						moveNodes.forEach((moveNode) => {
							if (positions[moveNode]) {
								originPositions[moveNode] = {
									x: positions[moveNode].x,
									y: positions[moveNode].y
								};
							}
							else if (savedPositions[moveNode]) {
								// Nó escondido (CORE colapsado): usa savedPosition como origem.
								originPositions[moveNode] = {
									x: savedPositions[moveNode].x,
									y: savedPositions[moveNode].y
								};
							}
						});

						dragState = {
							node: node,
							moveNodes: moveNodes,
							originPositions: originPositions,
							startClientX: event.clientX,
							startClientY: event.clientY,
							moved: false,
							pointerId: event.pointerId
						};

						if (this.setPointerCapture) {
							try {
								this.setPointerCapture(event.pointerId);
							}
							catch (e) {}
						}

						document.body.style.userSelect = 'none';
						document.body.style.cursor = 'grabbing';
						this.style.cursor = 'grabbing';
					});

					el.addEventListener('pointermove', function (event) {
						if (!dragState) return;
						if (dragState.pointerId !== event.pointerId) return;

						const delta = clientDeltaToSvg(
							svgEl,
							dragState.startClientX,
							dragState.startClientY,
							event.clientX,
							event.clientY
						);

						if (
							Math.abs(event.clientX - dragState.startClientX) > 1 ||
							Math.abs(event.clientY - dragState.startClientY) > 1
						) {
							dragState.moved = true;
						}

						dragState.moveNodes.forEach((moveNode) => {
							const origin = dragState.originPositions[moveNode];
							if (!origin) return;

							savedPositions[moveNode] = {
								x: origin.x + delta.dx,
								y: origin.y + delta.dy
							};
						});

						// Atualiza apenas os atributos SVG dos elementos movidos
						// (sem regerar todo o innerHTML — drag fluido).
						applyDragVisualUpdate(dragState.moveNodes);
					});

					el.addEventListener('pointerup', function (event) {
						if (!dragState) return;
						if (dragState.pointerId !== event.pointerId) return;

						if (dragState.moved) {
							saveSavedPositions(storageKey, savedPositions);
							suppressClickUntil = Date.now() + 220;
						}

						if (this.releasePointerCapture) {
							try {
								this.releasePointerCapture(event.pointerId);
							}
							catch (e) {}
						}

						document.body.style.userSelect = '';
						document.body.style.cursor = '';
						this.style.cursor = 'grab';

						dragState = null;
					});

					el.addEventListener('pointercancel', function (event) {
						if (!dragState) return;
						if (dragState.pointerId !== event.pointerId) return;

						if (this.releasePointerCapture) {
							try {
								this.releasePointerCapture(event.pointerId);
							}
							catch (e) {}
						}

						document.body.style.userSelect = '';
						document.body.style.cursor = '';
						this.style.cursor = 'grab';

						dragState = null;
					});

					el.addEventListener('click', function (event) {
						if (Date.now() < suppressClickUntil) return;

						if (event.target && event.target.closest && event.target.closest('.topology-toggle')) {
							return;
						}

						const node = this.dataset.node || '';
						if (!node) return;

						event.stopPropagation();

						selectedNode = node;
						rootEl.dataset.selectedNode = node;
						scheduleDraw();

						const html = renderPopupContent(node, model, hostLevels, statusMap, trafficMap, speedMap, {
							unmanagedSet: unmanagedSet,
							utilWarnPct: utilWarnPct,
							utilCritPct: utilCritPct
						});
						showPopup(rootEl, popupEl, html, event.clientX, event.clientY);
					});
				});

			}

			// ----------------------------------------------------------------
			// Listeners ANEXADOS UMA ÚNICA VEZ (fora de draw()) para evitar leak.
			// graphEl é o mesmo nó DOM em todos os draws (apenas o innerHTML muda),
			// então listeners anexados aqui sobrevivem aos redraws sem duplicar.
			// ----------------------------------------------------------------

			// Toggle dos CORES via event-delegation: a fonte de verdade do nó
			// clicado é SEMPRE o `<g class="topology-toggle">` mais próximo do
			// alvo do clique, independente de onde o listener está atribuído.
			graphEl.addEventListener('click', function (event) {
				const toggleEl = event.target && event.target.closest
					? event.target.closest('.topology-toggle')
					: null;
				if (!toggleEl || !graphEl.contains(toggleEl)) return;

				event.preventDefault();
				event.stopPropagation();

				const node = toggleEl.getAttribute('data-node') || '';
				if (!node) return;

				expandedState[node] = !expandedState[node];
				saveExpandedState(storageKey, expandedState);
				hidePopup(popupEl);
				scheduleDraw();
			}, true); // capture phase: garante que rodamos antes de qualquer outro click handler em filhos

			// ClearFocus em clique no fundo (também movido para fora de draw()).
			graphEl.addEventListener('click', function (event) {
				if (Date.now() < suppressClickUntil) return;

				// Se o clique foi em um toggle, o handler delegado acima já tratou (e parou propagação).
				if (event.target && event.target.closest && event.target.closest('.topology-toggle')) {
					return;
				}

				const svgElNow = graphEl.querySelector('svg');
				if (
					event.target === svgElNow
					|| event.target === graphEl
					|| (event.target && event.target.classList && event.target.classList.contains('topology-bg'))
				) {
					clearFocus();
				}
			});

			clearFocusBtn.addEventListener('click', function (event) {
				event.preventDefault();
				event.stopPropagation();
				clearFocus();
			});

			if (resetLayoutBtn) {
				resetLayoutBtn.addEventListener('click', function (event) {
					event.preventDefault();
					event.stopPropagation();
					if (!confirm('Resetar posições, expansão e zoom deste widget?')) return;
					try {
						localStorage.removeItem(storageKey);
						localStorage.removeItem(storageKey + ':expanded');
						localStorage.removeItem(viewKey);
					}
					catch (e) {}
					Object.keys(savedPositions).forEach((k) => { delete savedPositions[k]; });
					Object.keys(expandedState).forEach((k) => { delete expandedState[k]; });
					viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
					selectedNode = '';
					rootEl.dataset.selectedNode = '';
					scheduleDraw();
				});
			}

			document.addEventListener('keydown', function (event) {
				if (event.key === 'Escape') {
					clearFocus();
				}
			});

			draw();
		});
	}

	window.renderTopologyTestWidgets = scanAndRender;

	class WidgetTopologyTest extends CWidget {
		onStart() {
			setTimeout(scanAndRender, 0);
			setTimeout(scanAndRender, 300);
			setTimeout(scanAndRender, 1000);
		}

		onActivate() {
			setTimeout(scanAndRender, 0);
			setTimeout(scanAndRender, 300);
			setTimeout(scanAndRender, 1000);
		}
	}

	window.WidgetTopologyTest = WidgetTopologyTest;

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', scanAndRender);
	}
	else {
		setTimeout(scanAndRender, 0);
	}

	setInterval(scanAndRender, 5000);
})();