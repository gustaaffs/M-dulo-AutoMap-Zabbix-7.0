<?php

namespace Modules\TopologyWidgetTest\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldRadioButtonList;
use Zabbix\Widgets\Fields\CWidgetFieldIntegerBox;

class WidgetForm extends CWidgetForm {

	public const SHOW_ALL            = 0;
	public const SHOW_MANAGED_ONLY   = 1;
	public const SHOW_UNMANAGED_ONLY = 2;

	public function addFields(): self {
		return $this
			->addField(
				new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
			)
			->addField(
				(new CWidgetFieldIntegerBox('max_levels', _('Níveis de descoberta'), 1, 6))
					->setDefault(2)
			)
			->addField(
				(new CWidgetFieldRadioButtonList('show_unmanaged', _('Exibir hosts'), [
					self::SHOW_ALL             => _('Todos'),
					self::SHOW_MANAGED_ONLY    => _('Apenas monitorados'),
					self::SHOW_UNMANAGED_ONLY  => _('Apenas não monitorados')
				]))->setDefault(self::SHOW_ALL)
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
