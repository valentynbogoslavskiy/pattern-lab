<?php

/**
 * Implements template_preprocess_node().
 */
function STARTER_preprocess_node (&$variables) {
  // Set our own node type preprocess, drupal creates them by default, but seems to only run hook_preprocess_node__event
  // on event full pages, not event teasers as well
  $function = __FUNCTION__ . '_' . $variables['node']->getType();
  if (function_exists($function)) {
    $function($variables);
  }
}

/**
 * Implements template_preprocess_node_article().
 */
function STARTER_preprocess_node_article (&$variables) {}
