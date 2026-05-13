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
		new CWidgetFieldMultiSelectHostView($data['fields']['center_hostids'])
	)
	->addField(
		new CWidgetFieldRadioButtonListView($data['fields']['show_unmanaged'])
	)
	->addField(
		new CWidgetFieldRadioButtonListView($data['fields']['link_color_mode'])
	)
	->addField(
		new CWidgetFieldIntegerBoxView($data['fields']['util_warn_pct'])
	)
	->addField(
		new CWidgetFieldIntegerBoxView($data['fields']['util_crit_pct'])
	)
	->show();
