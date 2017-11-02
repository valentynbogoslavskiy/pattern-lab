<?php

/**
 * @file
 * Preprocess form and form elements.
 */

/**
 * Implements hook_preprocess_input().
 */
function draft_theme_preprocess_input(&$variables) {

  // Use <button> element instead of <input type="submit"/>.
  //
  // @todo Remove this when corresponding issue is fixed in Drupal core.
  // @see https://www.drupal.org/node/1671190
  if ($variables['attributes']['type'] === 'submit') {
    $variables['text'] = $variables['attributes']['value'];
  }
}
