<?php

namespace Modules\TopologyWidgetTest\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {

	// Topologia (BFS + resolução de hosts) muda raramente → TTL longo.
	private const TOPOLOGY_CACHE_TTL_SECONDS = 900; // 15 min
	// Telemetria (status/tráfego/speed) muda sempre → TTL curto.
	private const TELEMETRY_CACHE_TTL_SECONDS = 30;

	private const TOPOLOGY_CACHE_PREFIX  = 'topology_widget_test:topo:v1:';
	private const TELEMETRY_CACHE_PREFIX = 'topology_widget_test:tele:v1:';

	private function cacheGet(string $prefix, string $key) {
		if (function_exists('apcu_fetch')) {
			$ok = false;
			$value = apcu_fetch($prefix . $key, $ok);
			return $ok ? $value : null;
		}
		return null;
	}

	private function cacheSet(string $prefix, string $key, $value, int $ttl): void {
		if (function_exists('apcu_store')) {
			apcu_store($prefix . $key, $value, $ttl);
		}
	}

	private function normalizeNodeName(string $name): string {
		$name = trim($name);
		$name = strtolower($name);

		if (strpos($name, '.') !== false) {
			$name = explode('.', $name)[0];
		}

		return trim($name);
	}

	private function extractIds($raw): array {
		if (!is_array($raw)) {
			$raw = [$raw];
		}

		$ids = [];

		foreach ($raw as $value) {
			if (is_array($value) && isset($value['id']) && $value['id'] !== '') {
				$ids[] = (string) $value['id'];
			}
			elseif (is_scalar($value) && (string) $value !== '') {
				$ids[] = (string) $value;
			}
		}

		return array_values(array_unique($ids));
	}

	/**
	 * Busca itens "Vizinho CDP/LLDP" para os hostids informados.
	 * Tenta primeiro por tag (component=vizinho), faz fallback para search por nome.
	 */
	private function fetchVizinhoItems(array $hostids): array {
		if (!$hostids) return [];

		$items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name'],
			'hostids'   => $hostids,
			'monitored' => true,
			'tags'      => [
				['tag' => 'component', 'value' => 'vizinho', 'operator' => 1] // TAG_OPERATOR_EQUAL
			],
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (!is_array($items) || !$items) {
			$items = API::Item()->get([
				'output'    => ['itemid', 'hostid', 'name'],
				'hostids'   => $hostids,
				'monitored' => true,
				'search'    => ['name' => 'Vizinho'],
				'sortfield' => 'name',
				'sortorder' => 'ASC'
			]);
		}

		return is_array($items) ? $items : [];
	}

	/**
	 * Faz parse de um item "Vizinho CDP|LLDP : <peer> (Porta <porta>)".
	 * Retorna [protocol, target_raw, port] ou null.
	 */
	private function parseVizinhoItem(string $item_name): ?array {
		if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*\(Porta\s+(.+?)\)\s*$/iu', $item_name, $m)) {
			return [strtoupper(trim($m[1])), trim($m[2]), trim($m[3])];
		}
		if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*$/iu', $item_name, $m)) {
			return [strtoupper(trim($m[1])), trim($m[2]), ''];
		}
		return null;
	}

	/**
	 * Resolve nomes normalizados de vizinhos em hostids (entre todos os grupos).
	 * Retorna [norm => ['hostid'=>..., 'name'=>...]].
	 */
	private function resolveNeighborHostsByName(array $names_norm_to_raw): array {
		if (!$names_norm_to_raw) return [];

		$search_terms = array_values(array_unique(array_merge(
			array_keys($names_norm_to_raw),
			array_values($names_norm_to_raw)
		)));

		$hosts = API::Host()->get([
			'output' => ['hostid', 'host', 'name'],
			'search' => [
				'host' => $search_terms,
				'name' => $search_terms
			],
			'searchByAny' => true,
			'monitored_hosts' => true
		]);

		$resolved = [];
		if (is_array($hosts)) {
			foreach ($hosts as $h) {
				$norm_n = $this->normalizeNodeName($h['name']);
				$norm_t = $this->normalizeNodeName($h['host']);
				if (isset($names_norm_to_raw[$norm_n]) && !isset($resolved[$norm_n])) {
					$resolved[$norm_n] = ['hostid' => $h['hostid'], 'name' => $h['name']];
				}
				if (isset($names_norm_to_raw[$norm_t]) && !isset($resolved[$norm_t])) {
					$resolved[$norm_t] = ['hostid' => $h['hostid'], 'name' => $h['name']];
				}
			}
		}
		return $resolved;
	}

	protected function doAction(): void {
		$groupids = $this->extractIds($this->fields_values['groupids'] ?? []);

		$max_levels       = (int) ($this->fields_values['max_levels']       ?? 2);
		$show_unmanaged   = (int) ($this->fields_values['show_unmanaged']   ?? 0);
		$util_warn_pct    = (int) ($this->fields_values['util_warn_pct']    ?? 60);
		$util_crit_pct    = (int) ($this->fields_values['util_crit_pct']    ?? 85);

		if ($max_levels   < 1 || $max_levels   > 6)  $max_levels   = 2;
		if ($util_warn_pct < 1 || $util_warn_pct > 100) $util_warn_pct = 60;
		if ($util_crit_pct < 1 || $util_crit_pct > 100) $util_crit_pct = 85;
		if ($util_crit_pct < $util_warn_pct) $util_crit_pct = $util_warn_pct;

		$selected_group = $groupids ? $groupids[0] : null;

		$response = [
			'name' => $this->getInput('name', $this->widget->getDefaultName()),
			'selected_group' => $selected_group ?? 'nenhum',
			'group_name' => '',
			'unique_links' => [],
			'host_levels' => new \stdClass(),
			'unmanaged_nodes' => [],
			'interface_status_items' => [],
			'interface_traffic_items' => [],
			'interface_speed_items' => [],
			'config' => [
				'show_unmanaged' => $show_unmanaged,
				'util_warn_pct'  => $util_warn_pct,
				'util_crit_pct'  => $util_crit_pct,
				'max_levels'     => $max_levels
			],
			'message' => '',
			'user' => [
				'debug_mode' => $this->getDebugMode()
			]
		];

		if ($selected_group === null) {
			$response['message'] = 'Selecione um grupo no widget.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		// =========================================================
		// CACHE EM DUAS CAMADAS (refresh soft no backend):
		//  - Topologia (BFS + resolu\u00e7\u00e3o de hosts): TTL longo (15 min)
		//  - Telemetria (status/tr\u00e1fego/speed): TTL curto (30s)
		// =========================================================
		$topo_cache_key = $selected_group . ':L' . $max_levels;
		$topo_cached = $this->cacheGet(self::TOPOLOGY_CACHE_PREFIX, $topo_cache_key);

		$expanded_host_map = null;

		if (is_array($topo_cached)) {
			foreach (['group_name','unique_links','host_levels','unmanaged_nodes','message'] as $k) {
				if (array_key_exists($k, $topo_cached)) {
					$response[$k] = $topo_cached[$k];
				}
			}
			if (isset($topo_cached['expanded_host_map']) && is_array($topo_cached['expanded_host_map'])) {
				$expanded_host_map = $topo_cached['expanded_host_map'];
			}
		}

		// Se a topologia veio do cache, pulamos o BFS direto para a parte de telemetria.
		if ($expanded_host_map !== null) {
			$this->fetchAndAttachTelemetry($response, $expanded_host_map);
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$groups = API::HostGroup()->get([
			'output' => ['groupid', 'name'],
			'groupids' => [$selected_group]
		]);
		$response['group_name'] = $groups ? $groups[0]['name'] : ('Grupo ' . $selected_group);

		// === NÍVEL 0: hosts monitorados do grupo selecionado ===
		$lvl0_hosts = API::Host()->get([
			'output' => ['hostid', 'name'],
			'groupids' => [$selected_group],
			'monitored_hosts' => true
		]);

		if (!$lvl0_hosts) {
			$response['message'] = 'Nenhum host monitorado encontrado no grupo selecionado.';
			$this->cacheSet(self::TOPOLOGY_CACHE_PREFIX, $topo_cache_key, [
				'group_name'        => $response['group_name'],
				'unique_links'      => [],
				'host_levels'       => new \stdClass(),
				'unmanaged_nodes'   => [],
				'message'           => $response['message'],
				'expanded_host_map' => []
			], self::TOPOLOGY_CACHE_TTL_SECONDS);
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		// host_norm => ['hostid'=>..., 'name'=>..., 'level'=>N]
		$known_hosts = [];
		// hostid => name (mapa para anotar hosts em todos os níveis processados)
		$expanded_host_map = [];

		foreach ($lvl0_hosts as $h) {
			$norm = $this->normalizeNodeName($h['name']);
			$known_hosts[$norm] = ['hostid' => $h['hostid'], 'name' => $h['name'], 'level' => 0];
			$expanded_host_map[$h['hostid']] = $h['name'];
		}

		// === BFS por níveis ===
		$unique_map = [];
		$all_neighbor_names_norm = []; // norm => raw (para identificar não cadastrados)
		$current_level_norms = array_keys($known_hosts);

		for ($level = 0; $level < $max_levels && $current_level_norms; $level++) {
			$level_hostids = [];
			foreach ($current_level_norms as $norm) {
				if (!empty($known_hosts[$norm]['hostid'])) {
					$level_hostids[] = $known_hosts[$norm]['hostid'];
				}
			}

			$items = $this->fetchVizinhoItems($level_hostids);
			if (!$items) {
				break;
			}

			$discovered_norm_to_raw = [];

			foreach ($items as $item) {
				$source_raw = $expanded_host_map[$item['hostid']] ?? ('HostID ' . $item['hostid']);
				$parsed = $this->parseVizinhoItem(trim($item['name']));
				if (!$parsed) continue;
				[$protocol, $target_raw, $port] = $parsed;

				$source_norm = $this->normalizeNodeName($source_raw);
				$target_norm = $this->normalizeNodeName($target_raw);

				if ($source_norm === '' || $target_norm === '') continue;

				$all_neighbor_names_norm[$target_norm] = $target_raw;

				if (!isset($known_hosts[$target_norm])) {
					$discovered_norm_to_raw[$target_norm] = $target_raw;
				}

				$pair = [$source_norm, $target_norm];
				sort($pair, SORT_STRING);
				$key = implode('|', $pair) . '|' . $protocol . '|' . $port;

				if (!isset($unique_map[$key])) {
					$unique_map[$key] = [
						'source'   => $source_norm,
						'target'   => $target_norm,
						'protocol' => $protocol,
						'port'     => $port,
						'raw_item' => $item['name']
					];
				}
			}

			// Resolve hostids dos vizinhos descobertos neste passo
			$next_level_norms = [];
			if ($discovered_norm_to_raw) {
				$resolved = $this->resolveNeighborHostsByName($discovered_norm_to_raw);
				foreach ($discovered_norm_to_raw as $norm => $raw) {
					if (isset($resolved[$norm])) {
						$known_hosts[$norm] = [
							'hostid' => $resolved[$norm]['hostid'],
							'name'   => $resolved[$norm]['name'],
							'level'  => $level + 1
						];
						$expanded_host_map[$resolved[$norm]['hostid']] = $resolved[$norm]['name'];
						$next_level_norms[] = $norm;
					}
					else {
						// Vizinho não cadastrado — registra o nível mas sem hostid
						$known_hosts[$norm] = ['hostid' => null, 'name' => $raw, 'level' => $level + 1];
					}
				}
			}

			$current_level_norms = $next_level_norms;
		}

		$response['unique_links'] = array_values($unique_map);

		// host_levels: nome_normalizado => nível
		$host_levels = [];
		foreach ($known_hosts as $norm => $info) {
			$host_levels[$norm] = $info['level'];
		}
		$response['host_levels'] = $host_levels;

		if (!$response['unique_links']) {
			$response['message'] = 'Os itens foram encontrados, mas nenhum link único foi gerado.';
		}

		// Hosts não cadastrados (descobertos por CDP/LLDP mas sem hostid resolvido)
		$unmanaged_nodes = [];
		foreach ($all_neighbor_names_norm as $norm => $raw) {
			if (isset($known_hosts[$norm]) && empty($known_hosts[$norm]['hostid'])) {
				$unmanaged_nodes[] = $norm;
			}
		}
		$response['unmanaged_nodes'] = array_values(array_unique($unmanaged_nodes));

		// Salva cache de TOPOLOGIA (sem telemetria, TTL longo).
		$this->cacheSet(self::TOPOLOGY_CACHE_PREFIX, $topo_cache_key, [
			'group_name'        => $response['group_name'],
			'unique_links'      => $response['unique_links'],
			'host_levels'       => $response['host_levels'],
			'unmanaged_nodes'   => $response['unmanaged_nodes'],
			'message'           => $response['message'],
			'expanded_host_map' => $expanded_host_map
		], self::TOPOLOGY_CACHE_TTL_SECONDS);

		// Telemetria (TTL curto, cache pr\u00f3prio).
		$this->fetchAndAttachTelemetry($response, $expanded_host_map);

		$this->setResponse(new CControllerResponseData($response));
	}

	/**
	 * Busca status operacional, tr\u00e1fego e speed das interfaces dos hosts informados,
	 * com cache de TTL curto independente do cache de topologia.
	 */
	private function fetchAndAttachTelemetry(array &$response, array $expanded_host_map): void {
		$expanded_hostids = array_values(array_unique(array_keys($expanded_host_map)));
		if (!$expanded_hostids) return;

		sort($expanded_hostids, SORT_STRING);
		$tele_cache_key = md5(implode(',', $expanded_hostids));

		$tele_cached = $this->cacheGet(self::TELEMETRY_CACHE_PREFIX, $tele_cache_key);
		if (is_array($tele_cached)) {
			$response['interface_status_items']  = $tele_cached['interface_status_items']  ?? [];
			$response['interface_traffic_items'] = $tele_cached['interface_traffic_items'] ?? [];
			$response['interface_speed_items']   = $tele_cached['interface_speed_items']   ?? [];
			return;
		}

		$iface_items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name', 'lastvalue', 'units'],
			'hostids'   => $expanded_hostids,
			'monitored' => true,
			'search'    => [
				'name' => ['Operational status', 'Bits received', 'Bits sent', 'Speed']
			],
			'searchByAny' => true,
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (is_array($iface_items)) {
			foreach ($iface_items as $item) {
				$name = trim($item['name']);
				if (stripos($name, 'Interface ') !== 0) continue;

				$host_label = $expanded_host_map[$item['hostid']] ?? ('Host_' . $item['hostid']);
				$record = [
					'host'  => $host_label,
					'name'  => $name,
					'value' => (string) $item['lastvalue'],
					'units' => (string) ($item['units'] ?? '')
				];

				if (stripos($name, 'Operational status') !== false) {
					$response['interface_status_items'][] = $record;
				}
				elseif (stripos($name, 'Bits received') !== false || stripos($name, 'Bits sent') !== false) {
					$response['interface_traffic_items'][] = $record;
				}
				elseif (preg_match('/:\s*Speed\s*$/i', $name)) {
					$response['interface_speed_items'][] = $record;
				}
			}
		}

		$this->cacheSet(self::TELEMETRY_CACHE_PREFIX, $tele_cache_key, [
			'interface_status_items'  => $response['interface_status_items'],
			'interface_traffic_items' => $response['interface_traffic_items'],
			'interface_speed_items'   => $response['interface_speed_items']
		], self::TELEMETRY_CACHE_TTL_SECONDS);
	}
}
