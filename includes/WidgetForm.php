<?php

namespace Modules\TopologyWidgetTest\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectHost;
use Zabbix\Widgets\Fields\CWidgetFieldRadioButtonList;
use Zabbix\Widgets\Fields\CWidgetFieldIntegerBox;

class WidgetForm extends CWidgetForm {

	public const SHOW_ALL            = 0;
	public const SHOW_MANAGED_ONLY   = 1;
	public const SHOW_UNMANAGED_ONLY = 2;

	public const COLOR_MODE_STATUS      = 0;
	public const COLOR_MODE_UTILIZATION = 1;

	public function addFields(): self {
		return $this
			->addField(
				new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
			)
			->addField(
				new CWidgetFieldMultiSelectHost('center_hostids', _('Hosts centrais'))
			)
			->addField(
				(new CWidgetFieldRadioButtonList('show_unmanaged', _('Exibir hosts'), [
					self::SHOW_ALL             => _('Todos'),
					self::SHOW_MANAGED_ONLY    => _('Apenas monitorados'),
					self::SHOW_UNMANAGED_ONLY  => _('Apenas não monitorados')
				]))->setDefault(self::SHOW_ALL)
			)
			->addField(
				(new CWidgetFieldRadioButtonList('link_color_mode', _('Cor das linhas'), [
					self::COLOR_MODE_STATUS      => _('Por status (UP/DOWN)'),
					self::COLOR_MODE_UTILIZATION => _('Por utilização (%)')
				]))->setDefault(self::COLOR_MODE_STATUS)
			)
			->addField(
				(new CWidgetFieldIntegerBox('util_warn_pct', _('Limite amarelo (%)'), 1, 100))
					->setDefault(60)
			)
			->addField(
				(new CWidgetFieldIntegerBox('util_crit_pct', _('Limite vermelho (%)'), 1, 100))
					->setDefault(85)
			);
	}
}
