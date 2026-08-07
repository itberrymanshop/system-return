// Main JavaScript for Return Management System

$(document).ready(function () {

  // ── DataTables ──────────────────────────────────────────────────────────────
  setTimeout(function () {
    if ($('.datatable').length) {
      $('.datatable').each(function () {
        if ($.fn.DataTable.isDataTable(this)) return;

        var $table = $(this);
        var headerCols = $table.find('thead tr:first th').length;
        if (headerCols === 0) return;

        var $firstRow = $table.find('tbody tr').first();
        var hasColspan = $firstRow.find('td[colspan]').length > 0;
        if ($table.find('tbody tr').length === 1 && hasColspan) return;

        var bodyCols = $firstRow.find('td').length;
        if (bodyCols === 0 || bodyCols === headerCols) {
          try {
            var customOrder = [[0, 'desc']];
            if ($table.attr('data-order')) {
              try {
                customOrder = JSON.parse($table.attr('data-order'));
              } catch (e) {
                console.warn('Failed to parse custom order:', e);
              }
            }

            $table.DataTable({
              pageLength: 25,
              order: customOrder,
              responsive: true,
              destroy: true,
              deferRender: true,
              language: {
                search: '_INPUT_',
                searchPlaceholder: 'Search...',
                emptyTable: 'No data available'
              },
              columnDefs: [{ orderable: false, targets: -1 }]
            });
          } catch (e) {
            console.error('DataTables init error:', e);
          }
        }
      });
    }
  }, 100);

  // ── Bootstrap tooltips ────────────────────────────────────────────────────
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
    new bootstrap.Tooltip(el);
  });

  // ── Auto-hide flash alerts after 5 s ─────────────────────────────────────
  setTimeout(function () {
    $('.alert').fadeOut('slow');
  }, 5000);

  // ── Confirm delete ────────────────────────────────────────────────────────
  $(document).on('click', '.confirm-delete', function (e) {
    if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
      e.preventDefault();
    }
  });

  // ── Currency formatting ───────────────────────────────────────────────────
  $('.currency-input').on('blur', function () {
    var val = parseFloat($(this).val().replace(/[^0-9.-]/g, ''));
    if (!isNaN(val)) $(this).val(val.toFixed(2));
  });

  // ── Clear validation state on input ──────────────────────────────────────
  $('input, select, textarea').on('input change', function () {
    $(this).removeClass('is-invalid');
  });

});

// ── CSV export ────────────────────────────────────────────────────────────────
function exportTableToCSV(filename) {
  var rows = document.querySelectorAll('table tr');
  var csv = Array.from(rows).map(function (row) {
    return Array.from(row.querySelectorAll('td, th')).map(function (col) {
      return '"' + col.innerText.replace(/"/g, '""') + '"';
    }).join(',');
  });
  var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = window.URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
