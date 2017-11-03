<?php

/**
 * @file
 * Provides new and alters existing theme suggestions.
 */

/**
 * Implements hook_theme_suggestions_HOOK_alter() for form().
 */
function draft_theme_theme_suggestions_form_alter(array &$suggestions, array $variables) {
  $suggestions[] = 'form__' . str_replace('-', '_', $variables['element']['#form_id']);
}

/**
 * Implements hook_theme_suggestions_HOOK_alter() for form_element().
 */
function draft_theme_theme_suggestions_form_element_alter(array &$suggestions, array $variables) {
  $suggestions[] = 'form_element__' . str_replace('-', '_', $variables['element']['#type']);
}
