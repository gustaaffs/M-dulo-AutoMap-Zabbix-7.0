<?php

namespace Modules\TopologyWidgetTest\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {

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
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$unique_map = [];

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

		// Interface operational status items (porta está no vizinho/target)
		$status_items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name', 'lastvalue'],
			'hostids'   => $hostids,
			'monitored' => true,
			'search'    => ['name' => 'Operational status'],
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (is_array($status_items)) {
			foreach ($status_items as $item) {
				$name = trim($item['name']);
				// Aceita apenas itens que começam com "Interface"
				if (stripos($name, 'Interface ') !== 0) {
					continue;
				}
				$response['interface_status_items'][] = [
					'host'  => $host_map[$item['hostid']] ?? ('Host_' . $item['hostid']),
					'name'  => $name,
					'value' => (string) $item['lastvalue']
				];
			}
		}

		$this->setResponse(new CControllerResponseData($response));
	}
}