<?php

namespace Modules\TopologyWidgetTest\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {

	protected function doAction(): void {
		$response = [
			'name'         => $this->getInput('name', $this->widget->getDefaultName()),
			'unique_links' => [],
			'central_hosts'=> [],
			'message'      => '',
			'user'         => ['debug_mode' => $this->getDebugMode()]
		];

		// --- resolve group ---
		$groupids_raw = $this->fields_values['groupids'] ?? [];
		if (!is_array($groupids_raw)) {
			$groupids_raw = [$groupids_raw];
		}

		$selected_group = null;
		foreach ($groupids_raw as $v) {
			if (is_array($v) && isset($v['id']) && $v['id'] !== '') {
				$selected_group = (string) $v['id'];
				break;
			}
			elseif (is_scalar($v) && (string) $v !== '') {
				$selected_group = (string) $v;
				break;
			}
		}

		if (!$selected_group) {
			$response['message'] = 'Selecione um grupo no widget.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		// --- hosts in group ---
		$hosts = API::Host()->get([
			'output'          => ['hostid', 'name'],
			'groupids'        => [$selected_group],
			'monitored_hosts' => true
		]);

		if (!is_array($hosts) || !$hosts) {
			$response['message'] = 'Nenhum host monitorado no grupo selecionado.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$host_map = [];
		$hostids  = [];
		foreach ($hosts as $h) {
			$host_map[$h['hostid']] = $h['name'];
			$hostids[] = $h['hostid'];
		}

		// --- neighbor items (single string search to avoid API exception) ---
		$items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name'],
			'hostids'   => $hostids,
			'monitored' => true,
			'search'    => ['name' => 'Vizinho'],
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (!is_array($items) || !$items) {
			$response['message'] = 'Nenhum item "Vizinho CDP" ou "Vizinho LLDP" encontrado.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		// --- build unique link map ---
		$unique_map = [];

		foreach ($items as $item) {
			$source_raw = $host_map[$item['hostid']] ?? ('Host_' . $item['hostid']);
			$name       = trim($item['name']);
			$protocol   = '';
			$target_raw = '';
			$port       = '';

			if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*\(Porta\s+(.+?)\)\s*$/iu', $name, $m)) {
				$protocol   = strtoupper(trim($m[1]));
				$target_raw = trim($m[2]);
				$port       = trim($m[3]);
			}
			elseif (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*$/iu', $name, $m)) {
				$protocol   = strtoupper(trim($m[1]));
				$target_raw = trim($m[2]);
			}
			else {
				continue;
			}

			$src = strtolower(trim(explode('.', trim($source_raw))[0]));
			$tgt = strtolower(trim(explode('.', trim($target_raw))[0]));

			if ($src === '' || $tgt === '') {
				continue;
			}

			$pair = [$src, $tgt];
			sort($pair, SORT_STRING);
			$key = implode('|', $pair) . '|' . $protocol . '|' . $port;

			if (!isset($unique_map[$key])) {
				$unique_map[$key] = [
					'source'   => $src,
					'target'   => $tgt,
					'protocol' => $protocol,
					'port'     => $port
				];
			}
		}

		$response['unique_links'] = array_values($unique_map);

		if (!$response['unique_links']) {
			$response['message'] = 'Itens encontrados, mas nenhum link gerado. Verifique o formato dos nomes dos itens.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		// --- central hosts (optional) ---
		$center_hostids_raw = $this->fields_values['center_hostids'] ?? [];
		if (!is_array($center_hostids_raw)) {
			$center_hostids_raw = [$center_hostids_raw];
		}

		$center_hostids = [];
		foreach ($center_hostids_raw as $v) {
			if (is_array($v) && isset($v['id']) && $v['id'] !== '') {
				$center_hostids[] = (string) $v['id'];
			}
			elseif (is_scalar($v) && (string) $v !== '') {
				$center_hostids[] = (string) $v;
			}
		}

		if ($center_hostids) {
			$central_rows = API::Host()->get([
				'output'  => ['hostid', 'name'],
				'hostids' => $center_hostids
			]);

			if (is_array($central_rows)) {
				foreach ($central_rows as $row) {
					$norm = strtolower(trim(explode('.', trim($row['name']))[0]));
					$response['central_hosts'][] = [
						'hostid'     => $row['hostid'],
						'name'       => $row['name'],
						'normalized' => $norm
					];
				}
			}
		}

		$this->setResponse(new CControllerResponseData($response));
	}
}
