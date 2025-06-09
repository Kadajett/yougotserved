/* eslint-disable */
// interactive-elements-helper.js
// This script is injected into the page to find interactive elements

if (window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__) {
  console.log(`interactive-elements-helper.js already initialized.`);
} else {
  window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__ = true;
  /**
   * Find all interactive elements on the page
   * @param {Object} options - Options for finding elements
   * @param {string} [options.textQuery] - Text to search for within elements (fuzzy search)
   * @param {string} [options.selector] - CSS selector to filter elements
   * @param {boolean} [options.includeCoordinates=true] - Whether to include element coordinates
   * @param {Array<string>} [options.types] - Types of elements to include
   * @returns {Array} - Array of interactive elements with their details
   */
  function findInteractiveElements(options = {}) {
    const {
      textQuery,
      selector,
      includeCoordinates = true,
      types = ['button', 'link', 'input', 'select', 'textarea', 'checkbox', 'radio', 'form'],
    } = options;

    // If selector is provided, directly return that element
    if (selector) {
      try {
        const selectedElement = document.querySelector(selector);
        if (selectedElement) {
          // Determine the element type
          let elementType = 'unknown';
          if (
            selectedElement.tagName === 'BUTTON' ||
            selectedElement.getAttribute('role') === 'button' ||
            (selectedElement.tagName === 'INPUT' &&
              ['button', 'submit'].includes(selectedElement.getAttribute('type') || ''))
          ) {
            elementType = 'button';
          } else if (
            selectedElement.tagName === 'A' ||
            selectedElement.getAttribute('role') === 'link'
          ) {
            elementType = 'link';
          } else if (selectedElement.tagName === 'INPUT') {
            const inputType = selectedElement.getAttribute('type') || 'text';
            if (inputType === 'checkbox') elementType = 'checkbox';
            else if (inputType === 'radio') elementType = 'radio';
            else elementType = 'input';
          } else if (selectedElement.tagName === 'SELECT') {
            elementType = 'select';
          } else if (selectedElement.tagName === 'TEXTAREA') {
            elementType = 'textarea';
          } else if (selectedElement.tagName === 'FORM') {
            elementType = 'form';
          }

          // Return just this element's info
          return [createElementInfo(selectedElement, elementType, includeCoordinates)];
        } else {
          return { error: `No element found matching selector: ${selector}` };
        }
      } catch (error) {
        return { error: `Invalid selector: ${error.message}` };
      }
    }

    // If no selector provided, search the entire document
    let container = document;

    // Find all interactive elements
    const elements = [];

    // Find buttons if included in types
    if (types.includes('button')) {
      const buttons = container.querySelectorAll(
        'button, input[type="button"], input[type="submit"], [role="button"]',
      );
      buttons.forEach((button) => {
        if (isElementVisible(button) && isElementInteractive(button)) {
          const text = button.textContent?.trim() || button.getAttribute('value') || '';
          if (!textQuery || fuzzyMatch(text, textQuery)) {
            elements.push(createElementInfo(button, 'button', includeCoordinates));
          }
        }
      });
    }

    // Find links if included in types
    if (types.includes('link')) {
      const links = container.querySelectorAll('a, [role="link"]');
      links.forEach((link) => {
        if (isElementVisible(link) && isElementInteractive(link)) {
          const text = link.textContent?.trim() || '';
          if (!textQuery || fuzzyMatch(text, textQuery)) {
            elements.push(createElementInfo(link, 'link', includeCoordinates));
          }
        }
      });
    }

    // Find inputs if included in types
    const inputTypes = types.filter((t) =>
      ['input', 'checkbox', 'radio', 'textarea', 'select'].includes(t),
    );
    if (inputTypes.length > 0) {
      // Create selector for all requested input types
      let inputSelector = [];

      if (inputTypes.includes('input')) {
        inputSelector.push(
          'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
        );
      }
      if (inputTypes.includes('checkbox')) {
        inputSelector.push('input[type="checkbox"]');
      }
      if (inputTypes.includes('radio')) {
        inputSelector.push('input[type="radio"]');
      }
      if (inputTypes.includes('textarea')) {
        inputSelector.push('textarea');
      }
      if (inputTypes.includes('select')) {
        inputSelector.push('select');
      }

      const inputs = container.querySelectorAll(inputSelector.join(', '));
      inputs.forEach((input) => {
        if (isElementVisible(input) && isElementInteractive(input)) {
          const inputType = input.getAttribute('type') || input.tagName.toLowerCase();
          const placeholder = input.getAttribute('placeholder') || '';
          const label = findLabelForInput(input) || '';
          const text = label || placeholder;

          if (!textQuery || fuzzyMatch(text, textQuery)) {
            elements.push(createElementInfo(input, inputType, includeCoordinates));
          }
        }
      });
    }

    // Find forms if included in types
    if (types.includes('form')) {
      const forms = container.querySelectorAll('form');
      forms.forEach((form) => {
        if (isElementVisible(form)) {
          // For forms, we don't check text content for matching
          if (!textQuery) {
            elements.push(createElementInfo(form, 'form', includeCoordinates));
          }
        }
      });
    }

    return elements;
  }

  /**
   * Create element info object
   * @param {Element} element - The element
   * @param {string} type - Element type
   * @param {boolean} includeCoordinates - Whether to include coordinates
   * @returns {Object} - Element info
   */
  function createElementInfo(element, type, includeCoordinates) {
    const info = {
      type: type,
      selector: generateSelector(element),
      text:
        element.textContent?.trim() ||
        element.getAttribute('value') ||
        element.getAttribute('placeholder') ||
        '',
      isInteractive: isElementInteractive(element),
    };

    // Add type-specific properties
    switch (type) {
      case 'button':
        info.disabled =
          element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
        break;
      case 'link':
        info.href = element.getAttribute('href') || '';
        break;
      case 'checkbox':
      case 'radio':
        info.checked = element.checked;
        info.label = findLabelForInput(element) || '';
        break;
      case 'input':
      case 'textarea':
      case 'select':
        info.placeholder = element.getAttribute('placeholder') || '';
        info.label = findLabelForInput(element) || '';
        info.disabled = element.hasAttribute('disabled');
        break;
      case 'form':
        info.action = element.getAttribute('action') || '';
        info.method = element.getAttribute('method') || 'get';
        break;
    }

    // Add coordinates if requested
    if (includeCoordinates) {
      const rect = element.getBoundingClientRect();
      info.coordinates = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      };
    }

    return info;
  }

  /**
   * Check if an element is visible
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is visible
   */
  function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    // Check if element is in viewport
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    // Check if element is covered by another element
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return (
      element === elementAtPoint ||
      element.contains(elementAtPoint) ||
      elementAtPoint.contains(element)
    );
  }

  /**
   * Check if an element is interactive
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is interactive
   */
  function isElementInteractive(element) {
    // Check if element is disabled
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    // Check if element is hidden from assistive technology
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }

    return true;
  }

  /**
   * Find the label text for an input element
   * @param {Element} input - The input element
   * @returns {string} - The label text
   */
  function findLabelForInput(input) {
    // Check for label with 'for' attribute
    const id = input.getAttribute('id');
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) {
        return label.textContent?.trim() || '';
      }
    }

    // Check for parent label
    let parent = input.parentElement;
    while (parent) {
      if (parent.tagName === 'LABEL') {
        return parent.textContent?.trim() || '';
      }
      parent = parent.parentElement;
    }

    // Check for aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel;
    }

    return '';
  }

  /**
   * Generate a CSS selector for an element
   * @param {Element} element - The element to generate a selector for
   * @returns {string} - The CSS selector
   */
  function generateSelector(element) {
    // Try to use ID if available
    if (element.id) {
      return `#${element.id}`;
    }

    // Try to use unique classes if available
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/);
      if (classes.length > 0) {
        const selector = '.' + classes.join('.');
        // Check if this selector is unique
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    // Use tag name with nth-child as fallback
    let path = '';
    let current = element;

    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );

        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      path = selector + (path ? ' > ' + path : '');
      current = parent;
    }

    return path;
  }

  /**
   * Perform fuzzy text matching
   * @param {string} text - The text to search in
   * @param {string} query - The query to search for
   * @returns {boolean} - Whether the text matches the query
   */
  function fuzzyMatch(text, query) {
    if (!text || !query) return false;

    text = text.toLowerCase();
    query = query.toLowerCase();
    console.log('text', text, 'query', query);
    // Simple contains check
    if (text.includes(query)) return true;

    // More advanced fuzzy matching
    let textIndex = 0;
    let queryIndex = 0;

    while (textIndex < text.length && queryIndex < query.length) {
      if (text[textIndex] === query[queryIndex]) {
        queryIndex++;
      }
      textIndex++;
    }

    return queryIndex === query.length;
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getInteractiveElements') {
      try {
        const elements = findInteractiveElements({
          textQuery: request.textQuery,
          selector: request.selector,
          includeCoordinates: request.includeCoordinates !== false,
          types: request.types || [
            'button',
            'link',
            'input',
            'select',
            'textarea',
            'checkbox',
            'radio',
            'form',
          ],
        });

        sendResponse({
          success: true,
          elements: elements,
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: `Failed to get interactive elements: ${error.message}`,
        });
      }
      return true; // Indicates async response
    } else if (request.action === 'chrome_get_interactive_elements_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });

  console.log('Interactive elements helper script loaded');
}
