/**
 * @file foundation-setup.js
 *
 * This is required for any foundation functionality. It should be imported at the top
 * of any file that is implementing a foundation component. Webpack determines
 * dependencies so this will only be added once. Keep in mind this is where the global
 * Foundation is being initialized `$(document).foudnation()`, so it's probably reasonable
 * to include this in the `theme.js` file first, as well as Foundation component files.
 */

import { Foundation } from 'foundation-sites/js/foundation.core';
import { rtl, GetYoDigits, transitionend } from 'foundation-sites/js/foundation.util.core';
import { Box } from 'foundation-sites/js/foundation.util.box';
import { onImagesLoaded } from 'foundation-sites/js/foundation.util.imageLoader';
import { Keyboard } from 'foundation-sites/js/foundation.util.keyboard';
import { MediaQuery } from 'foundation-sites/js/foundation.util.mediaQuery';
import { Motion, Move } from 'foundation-sites/js/foundation.util.motion';
import { Nest } from 'foundation-sites/js/foundation.util.nest';
import { Timer } from 'foundation-sites/js/foundation.util.timer';

window.$ = jQuery;

Foundation.addToJquery(jQuery);

// Add Foundation Utils to Foundation global namespace for backwards
// compatibility.
Foundation.rtl = rtl;
Foundation.GetYoDigits = GetYoDigits;
Foundation.transitionend = transitionend;

Foundation.Box = Box;
Foundation.onImagesLoaded = onImagesLoaded;
Foundation.Keyboard = Keyboard;
Foundation.MediaQuery = MediaQuery;
Foundation.Motion = Motion;
Foundation.Move = Move;
Foundation.Nest = Nest;
Foundation.Timer = Timer;

// Initializing foundation - if you are relying on components generated from classes or attributes,
// you may need to make sure to appropriate modules are included beforehand
jQuery(document).foundation();
