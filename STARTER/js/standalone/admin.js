/**
 * @file entity-browser-improvements.js
 *
 * Adds extra UI improvements to all entity browsers in the admin theme.
 */

(($) => {
  Drupal.behaviors.entityBrowserImprover = {
    attach: (context) => {
      // Add .view-entity-browser-BROWSER-NAME to this list for browsers you
      // want to add the click item functionality
      let $browserSelectors = ['.view-entity-browser'];
      $browserSelectors = $browserSelectors.join(', ');
      let $browserCol = $($browserSelectors, context);
      $browserCol = $browserCol.find('.views-col');

      $browserCol.each((i, colEel) => {
        const $colEl = $(colEel);
        if (!$colEl.hasClass('processed')) {
          $colEl.click((e) => {
            e.preventDefault();
            const el = $(e.currentTarget);
            const checkbox = el.find('input[type="checkbox"]');

            checkbox.prop('checked', !checkbox.prop('checked'));
            el.toggleClass('column-selected');
          });
        }
        $colEl.addClass('processed');
      });
    },
  };
})(jQuery);
