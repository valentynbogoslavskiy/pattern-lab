<?php

/**
 * @file
 * Contains node related preprocess routines.
 */

/**
 * Implements hook_preprocess_node().
 */
function STARTER_preprocess_node(&$variables) {
  // Set our own node type preprocess, drupal creates them by default, but seems
  // to only run hook_preprocess_node__<bundle> on <bundle> full pages only, not
  // <bundle> teasers for example.
  $function = __FUNCTION__ . '_' . $variables['node']->getType();
  if (function_exists($function)) {
    $function($variables);
  }
}
