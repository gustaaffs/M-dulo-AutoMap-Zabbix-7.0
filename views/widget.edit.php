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
	->show();
