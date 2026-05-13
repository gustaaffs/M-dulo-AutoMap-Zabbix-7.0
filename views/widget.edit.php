<?php

/**
 * @var CView $this
 * @var array $data
 */

(new CWidgetFormView($data))
	->addField(
		new CWidgetFieldMultiSelectGroupView($data['fields']['groupids'])
	)
	->addField(
		new CWidgetFieldIntegerBoxView($data['fields']['max_levels'])
	)
	->addField(
		new CWidgetFieldRadioButtonListView($data['fields']['show_unmanaged'])
	)
	->addField(
		new CWidgetFieldIntegerBoxView($data['fields']['util_warn_pct'])
	)
	->addField(
		new CWidgetFieldIntegerBoxView($data['fields']['util_crit_pct'])
	)
	->show();
