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

             const dataTable = $table.DataTable({
               paging: false,
               pageLength: -1,
               lengthChange: false,
               order: customOrder,
               search: {
                 smart: $table.attr('data-search-smart') !== 'false'
               },
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

             if ($table.attr('data-vendor-search') === 'true') {
               const vendorColumn = headerCols - 1;
                               const searchInput = $(dataTable.table().container()).find('.dataTables_filter input');
                const exportButton = document.getElementById('supplierExportButton');
                const filterContainer = $(dataTable.table().container()).find('.dataTables_filter');
                filterContainer.css('position', 'relative');
                const searchButton = $('<button type="button" class="btn btn-sm btn-primary ms-1">Cari</button>').appendTo(filterContainer);
                let activeVendorSearch = '';

                function applyVendorSearch(value) {
                  activeVendorSearch = value.trim();
                  searchInput.val(activeVendorSearch);
                  dataTable.search('').columns().search('');
                  dataTable.column(vendorColumn).search(activeVendorSearch, false, false).draw();
                  if (exportButton) exportButton.href = `/inventory/category/return_to_supplier/export?vendor=${encodeURIComponent(activeVendorSearch)}`;
                }

                searchButton.on('click', function () {
                  applyVendorSearch(searchInput.val());
                  suggestions.hide();
                });
                searchInput.on('keydown.vendorSearch', function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchButton.trigger('click');
                  }
                });
                if (exportButton) {
                  exportButton.addEventListener('click', function (event) {
                    event.preventDefault();
                    window.location.href = `/inventory/category/return_to_supplier/export?vendor=${encodeURIComponent(activeVendorSearch)}`;
                  });
                }
                const suggestions = $('<div class="vendor-search-suggestions"></div>').hide().appendTo(filterContainer);
                const vendors = dataTable.column(vendorColumn).data().toArray()
                  .map(value => $('<div>').html(value).text().trim())
                  .filter(value => value && value !== '-')
                  .filter((value, index, values) => values.indexOf(value) === index)
                  .sort((a, b) => a.localeCompare(b, 'id'));

                searchInput.on('input.vendorSuggestions', function () {
                  const value = this.value.trim();
                  suggestions.empty();
                  if (!value) {
                    suggestions.hide();
                    return;
                  }
                  vendors.filter(vendor => vendor.toLowerCase().includes(value.toLowerCase())).slice(0, 8).forEach(vendor => {
                    $('<button type="button"></button>').text(vendor).on('click', () => applyVendorSearch(vendor)).appendTo(suggestions);
                  });
                  suggestions.toggle(suggestions.children().length > 0);
                });
                searchInput.on('focus.vendorSearch', function () {
                  if (this.value) searchInput.trigger('input');
                });
                $(document).on('click.vendorSearch', event => {
                  if (!$(event.target).closest(filterContainer).length) suggestions.hide();
                });
             }
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
