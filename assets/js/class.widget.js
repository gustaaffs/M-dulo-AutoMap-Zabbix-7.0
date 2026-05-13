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

		const scaleX = viewBox.width / rect.width;
		const scaleY = viewBox.height / rect.height;

		return {
			dx: (currentClientX - startClientX) * scaleX * DRAG_GAIN,
			dy: (currentClientY - startClientY) * scaleY * DRAG_GAIN
		};
	}

	function renderPopupContent(node, model, centralHosts, statusMap, trafficMap) {
		const neighbors = (model.adjacency[node] || []).slice().sort((a, b) => naturalCompare(a.peer, b.peer));
		const degree = model.degreeMap[node] || 0;
		const isCentral = (centralHosts || []).some((h) => normalizeName(h.normalized || h.name || '') === node);

		let tier = 'Borda';
		if (degree >= 4) tier = 'Core';
		else if (degree >= 2) tier = 'Distribuição';

		let html = '';
		html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
		html += '<div style="font-size:17px; font-weight:700;">' + esc(node) + '</div>';
		html += '<button type="button" class="topology-popup-close" style="background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px 8px;cursor:pointer;">Fechar</button>';
		html += '</div>';
		html += '<div style="margin-bottom:8px;"><strong>Camada:</strong> ' + esc(tier) + '</div>';
		html += '<div style="margin-bottom:8px;"><strong>Grau:</strong> ' + degree + '</div>';
		html += '<div style="margin-bottom:12px;"><strong>Host central:</strong> ' + (isCentral ? 'sim' : 'não') + '</div>';
		html += '<div style="font-size:14px; font-weight:700; margin-bottom:8px;">Conexões</div>';
		html += '<div style="max-height:280px; overflow:auto; border-top:1px solid #1f2937; padding-top:8px;">';

		neighbors.forEach((n) => {
			const info = getStatusInfo(statusMap, n.statusHost, n.statusPort);
			const status = info ? info.status : null;
			const statusColor = status === 'up' ? '#22c55e' : status === 'down' ? '#ef4444' : '#94a3b8';
			const traffic = getTrafficInfo(trafficMap, n.statusHost, n.statusPort);

			html += '<div style="padding:8px 0; border-bottom:1px solid #1f2937;">';
			html += '<div style="font-weight:600;">' + esc(n.peer) + '</div>';
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

		function scoreNodeForAnchor(node, anchor) {
			let score = 0;
			const neighbors = model.adjacency[node] || [];

			neighbors.forEach((n) => {
				if (n.peer === anchor) score += 10;

				const secondHop = model.adjacency[n.peer] || [];
				secondHop.forEach((n2) => {
					if (n2.peer === anchor) score += 2;
				});
			});

			return score;
		}

		model.nodes.forEach((node) => {
			if (anchorSet.has(node)) return;

			let bestAnchor = null;
			let bestScore = 0;

			anchors.forEach((anchor) => {
				const score = scoreNodeForAnchor(node, anchor);
				if (score > bestScore) {
					bestScore = score;
					bestAnchor = anchor;
				}
			});

			if (bestAnchor) {
				ownership[node] = bestAnchor;
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

	function layoutExpandedGraph(model, anchors, expandedState, ownership, width, height) {
		const positions = layoutCollapsedAnchors(anchors, width, height);
		const centerX = width / 2;
		const centerY = height * 0.53;

		anchors.forEach((anchor) => {
			if (!expandedState[anchor]) return;

			const anchorPos = positions[anchor];
			const neighbors = model.nodes
				.filter((n) => n !== anchor && ownership[n] === anchor)
				.sort((a, b) => {
					const da = model.degreeMap[a] || 0;
					const db = model.degreeMap[b] || 0;
					if (db !== da) return db - da;
					return naturalCompare(a, b);
				});

			const dx = anchorPos.x - centerX;
			const dy = anchorPos.y - centerY;
			const outwardAngle = Math.atan2(dy, dx);

			for (let i = 0; i < neighbors.length; i += 10) {
				const chunk = neighbors.slice(i, i + 10);
				const radius = 170 + (Math.floor(i / 10) * 80);
				const spreadDeg = Math.min(165, 95 + (chunk.length * 7));
				const halfSpread = (spreadDeg / 2) * Math.PI / 180;

				if (chunk.length === 1) {
					const ang = outwardAngle;
					positions[chunk[0]] = {
						x: anchorPos.x + Math.cos(ang) * radius,
						y: anchorPos.y + Math.sin(ang) * radius
					};
				}
				else {
					chunk.forEach((node, idx) => {
						const t = idx / (chunk.length - 1);
						const ang = outwardAngle - halfSpread + ((halfSpread * 2) * t);
						positions[node] = {
							x: anchorPos.x + Math.cos(ang) * radius,
							y: anchorPos.y + Math.sin(ang) * radius
						};
					});
				}
			}
		});

		return positions;
	}

	function buildMoveGroup(model, startNode, anchorSet, visibleNodesSet) {
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
		return Array.from(moveSet);
	}

	function scanAndRender() {
		document.querySelectorAll('.topology-test-widget').forEach((rootEl) => {
			if (rootEl.dataset.initialized === '1') return;

			const graphEl = rootEl.querySelector('.topology-test-graph');
			const popupEl = rootEl.querySelector('.topology-test-popup');
			const clearFocusBtn = rootEl.querySelector('.topology-clear-focus-btn');

			if (!graphEl || !popupEl || !clearFocusBtn) return;

			rootEl.dataset.initialized = '1';

			let links = [];
			let centralHosts = [];
			let interfaceStatuses = [];
			let interfaceTraffic = [];

			try {
				links = JSON.parse(atob(rootEl.dataset.links || ''));
			}
			catch (e) {
				graphEl.innerHTML = '<div style="padding:16px;color:#fff;">Erro ao ler os links da topologia.</div>';
				return;
			}

			try {
				centralHosts = JSON.parse(atob(rootEl.dataset.centralHosts || ''));
			}
			catch (e) {
				centralHosts = [];
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

			const statusMap = buildStatusMap(interfaceStatuses);
			const trafficMap = buildTrafficMap(interfaceTraffic);
			const model = buildModel(links);
			const preferredAnchors = centralHosts
				.map((host) => normalizeName(host.normalized || host.name || ''))
				.filter((name, index, arr) => name && arr.indexOf(name) === index);

			const anchors = preferredAnchors.length ? preferredAnchors : model.nodes.filter((n) => (model.degreeMap[n] || 0) >= 4);
			const storageKey = getStorageKey(rootEl, anchors);
			const savedPositions = loadSavedPositions(storageKey);
			const expandedState = loadExpandedState(storageKey);
			const ownership = buildAnchorOwnership(model, anchors);

			let selectedNode = rootEl.dataset.selectedNode || '';
			let suppressClickUntil = 0;
			let framePending = false;
			let dragState = null;

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
					const letter = g.querySelector('.topology-node-letter');
					const label = g.querySelector('.topology-node-label');

					if (circle) {
						circle.setAttribute('cx', pos.x);
						circle.setAttribute('cy', pos.y);
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
					? layoutExpandedGraph(model, anchors, expandedState, ownership, width, height)
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
				svg += '<div style="width:100%; height:100%; overflow:auto;">';
				svg += '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1100" viewBox="0 0 1800 1100" style="display:block;">';
				svg += '<rect x="0" y="0" width="1800" height="1100" fill="#0f172a"/>';

				visible.links.forEach((link, linkIdx) => {
					const s = link.source;
					const t = link.target;

					if (!positions[s] || !positions[t]) return;

					const active = !selectedNode || s === selectedNode || t === selectedNode;
					let color = '#60a5fa';
					if (String(link.protocol || '').toUpperCase() === 'LLDP') {
						color = '#34d399';
					}

					// Status: usa membros se houver (cobre tanto link individual quanto agregado),
					// senão tenta o statusHost/statusPort principal.
					let aggStatus = aggregateMembersStatus(statusMap, link.members);
					if (!aggStatus && link.statusHost) {
						const sInfo = getStatusInfo(statusMap, link.statusHost, link.statusPort);
						if (sInfo) aggStatus = sInfo.status;
					}
					if (aggStatus === 'up') color = '#22c55e';
					else if (aggStatus === 'down') color = '#ef4444';

					const dash = String(link.protocol || '').toUpperCase() === 'LLDP' ? ' stroke-dasharray="6 3" ' : '';
					const opacity = active ? 0.9 : 0.18;
					const strokeWidth = active ? 2.6 : 1.2;

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
						+ dash
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

					let fill = isCentral ? '#2563eb' : '#475569';
					let radius = isCentral ? 30 : 19;

					let nodeOpacity = 1;
					if (selectedNode && !isSelected && !isNeighbor) nodeOpacity = 0.25;

					let stroke = isCentral ? '#fbbf24' : '#ffffff';
					let strokeWidth = isCentral ? 3 : 2;

					if (isSelected) {
						stroke = '#facc15';
						strokeWidth = 5;
					}

					const x = positions[node].x;
					const y = positions[node].y;

					svg += '<g class="topology-node" data-node="' + esc(node) + '" style="cursor:grab;">';
					svg += '<circle class="topology-node-circle" cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" opacity="' + nodeOpacity + '"/>';
					svg += '<text class="topology-node-letter" x="' + x + '" y="' + (y + 4) + '" fill="#ffffff" font-size="11" font-weight="700" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">R</text>';
					svg += '<text class="topology-node-label" data-radius="' + radius + '" x="' + x + '" y="' + (y + radius + 18) + '" fill="#e2e8f0" font-size="11" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">' + esc(shortName(node, 16)) + '</text>';

					if (isCentral) {
						const symbol = isExpanded ? '−' : '+';
						svg += '<g class="topology-toggle" data-node="' + esc(node) + '" data-radius="' + radius + '" style="cursor:pointer;">';
						svg += '<circle class="topology-toggle-circle" cx="' + (x + radius - 2) + '" cy="' + (y - radius + 2) + '" r="11" fill="#111827" stroke="#94a3b8" stroke-width="1.5"/>';
						svg += '<text class="topology-toggle-text" x="' + (x + radius - 2) + '" y="' + (y - radius + 6) + '" fill="#f8fafc" font-size="14" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700">' + symbol + '</text>';
						svg += '</g>';
					}

					svg += '</g>';
				});

				svg += '</svg>';
				svg += '</div>';

				graphEl.innerHTML = svg;

				const svgEl = graphEl.querySelector('svg');
				if (!svgEl) return;

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

				graphEl.querySelectorAll('.topology-toggle').forEach((el) => {
					el.addEventListener('click', function (event) {
						event.preventDefault();
						event.stopPropagation();

						const node = this.dataset.node || '';
						if (!node) return;

						expandedState[node] = !expandedState[node];
						saveExpandedState(storageKey, expandedState);
						hidePopup(popupEl);
						scheduleDraw();
					});
				});

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

						const moveNodes = buildMoveGroup(model, node, anchorSet, visibleNodesSet);
						const originPositions = {};

						moveNodes.forEach((moveNode) => {
							if (positions[moveNode]) {
								originPositions[moveNode] = {
									x: positions[moveNode].x,
									y: positions[moveNode].y
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

						const html = renderPopupContent(node, model, centralHosts, statusMap, trafficMap);
						showPopup(rootEl, popupEl, html, event.clientX, event.clientY);
					});
				});

				graphEl.addEventListener('click', function (event) {
					if (event.target === svgEl || event.target === graphEl) {
						clearFocus();
					}
				});
			}

			clearFocusBtn.addEventListener('click', function (event) {
				event.preventDefault();
				event.stopPropagation();
				clearFocus();
			});

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