<?php

namespace Modules\TopologyWidgetTest\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {

	private const CACHE_TTL_SECONDS = 30;
	private const CACHE_PREFIX = 'topology_widget_test:v1:';

	private function cacheGet(string $key) {
		if (function_exists('apcu_fetch')) {
			$ok = false;
			$value = apcu_fetch(self::CACHE_PREFIX . $key, $ok);
			return $ok ? $value : null;
		}
		return null;
	}

	private function cacheSet(string $key, $value): void {
		if (function_exists('apcu_store')) {
			apcu_store(self::CACHE_PREFIX . $key, $value, self::CACHE_TTL_SECONDS);
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

	protected function doAction(): void {
		$groupids = $this->extractIds($this->fields_values['groupids'] ?? []);
		$center_hostids = $this->extractIds($this->fields_values['center_hostids'] ?? []);

		$selected_group = $groupids ? $groupids[0] : null;

		$response = [
			'name' => $this->getInput('name', $this->widget->getDefaultName()),
			'selected_group' => $selected_group ?? 'nenhum',
			'group_name' => '',
			'unique_links' => [],
			'central_hosts' => [],
			'interface_status_items' => [],
			'interface_traffic_items' => [],
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

		// Cache curto (TTL=30s) para reduzir carga na API/DB quando vários
		// dashboards/abas exibem o mesmo widget. A chave inclui grupo + centrais.
		$cache_key = $selected_group . ':' . implode(',', $center_hostids);
		$cached = $this->cacheGet($cache_key);

		if (is_array($cached)) {
			$response['group_name']             = $cached['group_name'] ?? '';
			$response['unique_links']           = $cached['unique_links'] ?? [];
			$response['central_hosts']          = $cached['central_hosts'] ?? [];
			$response['interface_status_items'] = $cached['interface_status_items'] ?? [];
			$response['interface_traffic_items']= $cached['interface_traffic_items'] ?? [];
			$response['message']                = $cached['message'] ?? '';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$groups = API::HostGroup()->get([
			'output' => ['groupid', 'name'],
			'groupids' => [$selected_group]
		]);

		if ($groups) {
			$response['group_name'] = $groups[0]['name'];
		}
		else {
			$response['group_name'] = 'Grupo ' . $selected_group;
		}

		$hosts = API::Host()->get([
			'output' => ['hostid', 'name'],
			'groupids' => [$selected_group],
			'monitored_hosts' => true
		]);

		if (!$hosts) {
			$response['message'] = 'Nenhum host monitorado encontrado no grupo selecionado.';
			$this->cacheSet($cache_key, [
				'group_name' => $response['group_name'],
				'unique_links' => [],
				'central_hosts' => [],
				'interface_status_items' => [],
				'interface_traffic_items' => [],
				'message' => $response['message']
			]);
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$host_map = [];
		$hostids = [];

		foreach ($hosts as $host) {
			$host_map[$host['hostid']] = $host['name'];
			$hostids[] = $host['hostid'];
		}

		$items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name'],
			'hostids'   => $hostids,
			'monitored' => true,
			'search'    => ['name' => 'Vizinho'],
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (!is_array($items) || !$items) {
			$response['message'] = 'Nenhum item "Vizinho CDP" ou "Vizinho LLDP" foi encontrado.';
			$this->cacheSet($cache_key, [
				'group_name' => $response['group_name'],
				'unique_links' => [],
				'central_hosts' => [],
				'interface_status_items' => [],
				'interface_traffic_items' => [],
				'message' => $response['message']
			]);
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$unique_map = [];
		$neighbor_names_norm = [];

		foreach ($items as $item) {
			$source_host_raw = $host_map[$item['hostid']] ?? ('HostID ' . $item['hostid']);
			$item_name = trim($item['name']);

			$protocol = '';
			$target_raw = '';
			$port = '';

			if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*\(Porta\s+(.+?)\)\s*$/iu', $item_name, $matches)) {
				$protocol = strtoupper(trim($matches[1]));
				$target_raw = trim($matches[2]);
				$port = trim($matches[3]);
			}
			elseif (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*$/iu', $item_name, $matches)) {
				$protocol = strtoupper(trim($matches[1]));
				$target_raw = trim($matches[2]);
				$port = '';
			}
			else {
				continue;
			}

			$source_norm = $this->normalizeNodeName($source_host_raw);
			$target_norm = $this->normalizeNodeName($target_raw);

			if ($source_norm === '' || $target_norm === '') {
				continue;
			}

			$neighbor_names_norm[$target_norm] = $target_raw;

			$pair = [$source_norm, $target_norm];
			sort($pair, SORT_STRING);

			$key = implode('|', $pair) . '|' . $protocol . '|' . $port;

			if (!isset($unique_map[$key])) {
				$unique_map[$key] = [
					'source' => $source_norm,
					'target' => $target_norm,
					'protocol' => $protocol,
					'port' => $port,
					'raw_item' => $item_name
				];
			}
		}

		$response['unique_links'] = array_values($unique_map);

		if ($center_hostids) {
			$central_rows = API::Host()->get([
				'output' => ['hostid', 'name'],
				'hostids' => $center_hostids
			]);

			if (is_array($central_rows)) {
				foreach ($central_rows as $row) {
					$response['central_hosts'][] = [
						'hostid' => $row['hostid'],
						'name' => $row['name'],
						'normalized' => $this->normalizeNodeName($row['name'])
					];
				}
			}
		}

		if (!$response['unique_links']) {
			$response['message'] = 'Os itens foram encontrados, mas nenhum link único foi gerado.';
		}

		// Resolve hostids dos vizinhos (target) que possivelmente estão fora do grupo
		// para que possamos buscar status/tráfego nas portas deles também.
		$expanded_hostids = $hostids;
		$expanded_host_map = $host_map;

		if ($neighbor_names_norm) {
			$missing_norm = [];
			$known_norm_set = [];

			foreach ($host_map as $hname) {
				$known_norm_set[$this->normalizeNodeName($hname)] = true;
			}

			foreach ($neighbor_names_norm as $norm => $raw) {
				if (!isset($known_norm_set[$norm])) {
					$missing_norm[$norm] = $raw;
				}
			}

			if ($missing_norm) {
				// Tenta buscar por host (technical name) e name (visible name)
				$search_terms = array_values(array_unique(array_merge(
					array_keys($missing_norm),
					array_values($missing_norm)
				)));

				$extra_hosts = API::Host()->get([
					'output' => ['hostid', 'host', 'name'],
					'search' => [
						'host' => $search_terms,
						'name' => $search_terms
					],
					'searchByAny' => true,
					'monitored_hosts' => true
				]);

				if (is_array($extra_hosts)) {
					foreach ($extra_hosts as $eh) {
						$norm_h = $this->normalizeNodeName($eh['name']);
						$norm_t = $this->normalizeNodeName($eh['host']);
						if (isset($missing_norm[$norm_h]) || isset($missing_norm[$norm_t])) {
							if (!isset($expanded_host_map[$eh['hostid']])) {
								$expanded_host_map[$eh['hostid']] = $eh['name'];
								$expanded_hostids[] = $eh['hostid'];
							}
						}
					}
				}
			}
		}

		$expanded_hostids = array_values(array_unique($expanded_hostids));

		// Interface operational status + bandwidth (porta está no vizinho/target)
		$iface_items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name', 'lastvalue', 'units'],
			'hostids'   => $expanded_hostids,
			'monitored' => true,
			'search'    => [
				'name' => ['Operational status', 'Bits received', 'Bits sent']
			],
			'searchByAny' => true,
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (is_array($iface_items)) {
			foreach ($iface_items as $item) {
				$name = trim($item['name']);
				if (stripos($name, 'Interface ') !== 0) {
					continue;
				}

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
			}
		}

		$this->cacheSet($cache_key, [
			'group_name'              => $response['group_name'],
			'unique_links'            => $response['unique_links'],
			'central_hosts'           => $response['central_hosts'],
			'interface_status_items'  => $response['interface_status_items'],
			'interface_traffic_items' => $response['interface_traffic_items'],
			'message'                 => $response['message']
		]);

		$this->setResponse(new CControllerResponseData($response));
	}
}