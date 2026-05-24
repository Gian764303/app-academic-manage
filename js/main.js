import './firebase-config.js';
import { initAuthUI } from './auth-service.js';

initAuthUI();

// Function to handle showing the floating tooltip on click
function addFloatingTooltipClickListeners() {
  const tableCells = document.querySelectorAll('.table-cell');

  tableCells.forEach(cell => {
    cell.addEventListener('click', (event) => {
      // Remove existing tooltips
      document.querySelectorAll('.floating-tooltip').forEach(tooltip => tooltip.remove());
      document.querySelectorAll('.table-cell').forEach(c => c.classList.remove('active'));

      const content = event.target.textContent;
      if (event.target.scrollWidth > event.target.clientWidth) {
        let tooltip = document.createElement('div');
        tooltip.className = 'floating-tooltip';
        tooltip.textContent = content;
        event.target.appendChild(tooltip);
        event.target.classList.add('active');
      }
    });

    // Remove tooltip on clicking outside
    document.addEventListener('click', (e) => {
      if (!cell.contains(e.target)) {
        const tooltip = cell.querySelector('.floating-tooltip');
        if (tooltip) {
          tooltip.remove();
          cell.classList.remove('active');
        }
      }
    });
  });
}

// Call the function after the table is rendered
document.addEventListener('DOMContentLoaded', () => {
  addFloatingTooltipClickListeners();
});
