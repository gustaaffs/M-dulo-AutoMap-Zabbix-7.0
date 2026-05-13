<?php

/**
 * @var CView $this
 * @var array $data
 */

$widget = new CWidgetView($data);

if (!empty($data['message'])) {
	$box = new CDiv($data['message']);
	$box->setAttribute('style', 'padding:16px; color:#e5e7eb; background:#0f172a; border:1px solid #1e293b; border-radius:10px; min-height:300px; box-sizing:border-box;');
	$widget->addItem($box);
	$widget->show();
	return;
}

$links_json = json_encode($data['unique_links'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$links_b64 = base64_encode($links_json);

$levels_json = json_encode($data['host_levels'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$levels_b64 = base64_encode($levels_json);

$status_json = json_encode($data['interface_status_items'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$status_b64 = base64_encode($status_json);

$traffic_json = json_encode($data['interface_traffic_items'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$traffic_b64 = base64_encode($traffic_json);

$speed_json = json_encode($data['interface_speed_items'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$speed_b64 = base64_encode($speed_json);

$unmanaged_json = json_encode($data['unmanaged_nodes'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$unmanaged_b64 = base64_encode($unmanaged_json);

$config_json = json_encode($data['config'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$config_b64 = base64_encode($config_json);

$root = new CDiv();
$root->addClass('topology-test-widget');
$root->setAttribute('data-links', $links_b64);
$root->setAttribute('data-host-levels', $levels_b64);
$root->setAttribute('data-interface-statuses', $status_b64);
$root->setAttribute('data-interface-traffic', $traffic_b64);
$root->setAttribute('data-interface-speed', $speed_b64);
$root->setAttribute('data-unmanaged-nodes', $unmanaged_b64);
$root->setAttribute('data-widget-config', $config_b64);
$root->setAttribute('data-group-name', (string) ($data['group_name'] ?? ''));
$root->setAttribute('data-group-id', (string) ($data['selected_group'] ?? ''));
$root->setAttribute('style', 'position:relative; width:100%; height:100%; min-height:520px; background:#0f172a; border:1px solid #1e293b; border-radius:10px; overflow:hidden; box-sizing:border-box;');

$graph = new CDiv();
$graph->addClass('topology-test-graph');
$graph->setAttribute('style', 'position:absolute; inset:0; width:100%; height:100%; background:#0f172a; overflow:hidden;');

$popup = new CDiv();
$popup->addClass('topology-test-popup');
$popup->setAttribute('style', 'display:none; position:absolute; z-index:30; width:320px; max-width:320px; background:#111827; color:#e5e7eb; border:1px solid #1f2937; border-radius:10px; box-shadow:0 20px 40px rgba(0,0,0,0.35); padding:14px; box-sizing:border-box;');

$focus_btn = new CDiv('Limpar foco');
$focus_btn->addClass('topology-clear-focus-btn');
$focus_btn->setAttribute('style', 'position:absolute; top:12px; right:12px; z-index:25; display:none; padding:8px 12px; border-radius:8px; background:#111827; color:#e5e7eb; border:1px solid #374151; cursor:pointer; user-select:none;');

$reset_btn = new CDiv('↺ Resetar');
$reset_btn->addClass('topology-reset-layout-btn');
$reset_btn->setAttribute('title', _('Resetar layout (posições e zoom) deste widget'));
$reset_btn->setAttribute('style', 'position:absolute; top:12px; left:12px; z-index:25; padding:6px 10px; border-radius:8px; background:#111827; color:#e5e7eb; border:1px solid #374151; cursor:pointer; user-select:none; font-size:12px;');

$root->addItem($graph);
$root->addItem($popup);
$root->addItem($focus_btn);
$root->addItem($reset_btn);

$widget->addItem($root);
$widget->show();