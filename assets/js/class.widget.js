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

	function anchorGroupKey(name) {
		let base = normalizeName(name);
		base = base.replace(/[-_.]?\d+$/, '');
		base = base.replace(/[-_.]+$/, '');
		return base || normalizeName(name);
	}

	const DRAG_GAIN = 1.8;

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

			adjacency[source].push({
				peer: target,
				protocol: protocol,
				port: port,
				rawItem: rawItem
			});

			adjacency[target].push({
				peer: source,
				protocol: protocol,
				port: port,
				rawItem: rawItem
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

	function renderPopupContent(node, model, centralHosts) {
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
		html += '<div style="max-height:240px; overflow:auto; border-top:1px solid #1f2937; padding-top:8px;">';

		neighbors.forEach((n) => {
			html += '<div style="padding:8px 0; border-bottom:1px solid #1f2937;">';
			html += '<div style="font-weight:600;">' + esc(n.peer) + '</div>';
			html += '<div style="font-size:12px; color:#cbd5e1;">Protocolo: ' + esc(n.protocol || '-') + '</div>';
			html += '<div style="font-size:12px; color:#cbd5e1;">Porta: ' + esc(n.port || '-') + '</div>';
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
		const seen = new Set();

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
				if (seen.has(pairKey)) return;

				visibleLinks.push({
					source: source,
					target: target,
					protocol: n.protocol || '',
					port: ''
				});

				seen.add(pairKey);
			});
		});

		return { nodes: visibleNodes, links: visibleLinks };
	}

	function buildExpandedVisibleGraph(model, anchors, expandedState, ownership) {
		const visibleNodes = new Set();
		const visibleLinks = [];
		const seen = new Set();

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

				const pairKey = [source, target].sort(naturalCompare).join('|') + '|' + (n.protocol || '') + '|' + (source === ownerA && target === ownerB ? 'agg' : (n.port || ''));

				if (seen.has(pairKey)) return;

				visibleLinks.push({
					source: source,
					target: target,
					protocol: n.protocol || '',
					port: source === ownerA && target === ownerB ? '' : (n.port || '')
				});

				seen.add(pairKey);
			});
		});

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

				visible.links.forEach((link) => {
					const s = link.source;
					const t = link.target;

					if (!positions[s] || !positions[t]) return;

					const active = !selectedNode || s === selectedNode || t === selectedNode;
					let color = '#60a5fa';
					if (String(link.protocol || '').toUpperCase() === 'LLDP') {
						color = '#34d399';
					}

					const dash = String(link.protocol || '').toUpperCase() === 'LLDP' ? ' stroke-dasharray="6 3" ' : '';
					const opacity = active ? 0.9 : 0.12;
					const strokeWidth = active ? 2.4 : 1.0;

					svg += '<line '
						+ 'x1="' + positions[s].x + '" '
						+ 'y1="' + positions[s].y + '" '
						+ 'x2="' + positions[t].x + '" '
						+ 'y2="' + positions[t].y + '" '
						+ 'stroke="' + color + '" '
						+ 'stroke-width="' + strokeWidth + '" '
						+ 'opacity="' + opacity + '" '
						+ dash
						+ '/>';
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
					svg += '<circle cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" opacity="' + nodeOpacity + '"/>';
					svg += '<text x="' + x + '" y="' + (y + 4) + '" fill="#ffffff" font-size="11" font-weight="700" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">R</text>';
					svg += '<text x="' + x + '" y="' + (y + radius + 18) + '" fill="#e2e8f0" font-size="11" text-anchor="middle" font-family="Arial, sans-serif" opacity="' + nodeOpacity + '">' + esc(shortName(node, 16)) + '</text>';

					if (isCentral) {
						const symbol = isExpanded ? '−' : '+';
						svg += '<g class="topology-toggle" data-node="' + esc(node) + '" style="cursor:pointer;">';
						svg += '<circle cx="' + (x + radius - 2) + '" cy="' + (y - radius + 2) + '" r="11" fill="#111827" stroke="#94a3b8" stroke-width="1.5"/>';
						svg += '<text x="' + (x + radius - 2) + '" y="' + (y - radius + 6) + '" fill="#f8fafc" font-size="14" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700">' + symbol + '</text>';
						svg += '</g>';
					}

					svg += '</g>';
				});

				svg += '</svg>';
				svg += '</div>';

				graphEl.innerHTML = svg;

				const svgEl = graphEl.querySelector('svg');
				if (!svgEl) return;

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

						scheduleDraw();
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

						const html = renderPopupContent(node, model, centralHosts);
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

	setInterval(scanAndRender, 1500);
})();