// Main JavaScript file for Return Management System

$(document).ready(function() {
    // Initialize DataTables with better error handling
    // Small delay to ensure DOM is fully rendered
    setTimeout(function() {
        if ($('.datatable').length) {
            $('.datatable').each(function() {
                // Check if already initialized
                if ($.fn.DataTable.isDataTable(this)) {
                    return;
                }
                
                var $table = $(this);
                
                // Validate table structure
                var $header = $table.find('thead tr:first th');
                var $firstRow = $table.find('tbody tr:not([data-dt-row])').first();
                var headerCols = $header.length;
                
                // Skip empty tables or tables with only "no data" message
                if (headerCols === 0) {
                    return;
                }
                
                // Check if tbody has colspan (empty state)
                var hasColspan = $firstRow.find('td[colspan]').length > 0;
                
                // If empty table, skip DataTables initialization
                if ($table.find('tbody tr').length === 1 && hasColspan) {
                    console.log('Skipping DataTables for empty table');
                    return;
                }
                
                var bodyCols = $firstRow.find('td').length;
                
                // Only initialize if table has valid structure
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
                                search: "_INPUT_",
                                searchPlaceholder: "Search...",
                                emptyTable: "No data available"
                            },
                            columnDefs: [
                                { orderable: false, targets: -1 }
                            ]
                        });
                    } catch (e) {
                        console.error('DataTables initialization error:', e);
                    }
                } else {
                    console.warn('Table structure mismatch - Header cols:', headerCols, 'Body cols:', bodyCols);
                }
            });
        }
    }, 100);

    
    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Auto-hide alerts after 5 seconds
    setTimeout(function() {
        $('.alert').fadeOut('slow');
    }, 5000);
    
    // Confirm delete actions
    $('.confirm-delete').on('click', function(e) {
        if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
            e.preventDefault();
        }
    });
    
    // Number formatting
    $('.currency-input').on('blur', function() {
        var value = parseFloat($(this).val().replace(/[^0-9.-]/g, ''));
        if (!isNaN(value)) {
            $(this).val(value.toFixed(2));
        }
    });
    
    // Form validation
    $('form[data-validate="true"]').on('submit', function(e) {
        var valid = true;
        $(this).find('[required]').each(function() {
            if (!$(this).val()) {
                $(this).addClass('is-invalid');
                valid = false;
            } else {
                $(this).removeClass('is-invalid');
            }
        });
        
        if (!valid) {
            e.preventDefault();
            alert('Please fill in all required fields');
        }
    });
    
    // Clear invalid class on input
    $('input, select, textarea').on('input change', function() {
        $(this).removeClass('is-invalid');
    });
});

// Dynamic item addition for returns
var itemCounter = 1;

function addReturnItem() {
    itemCounter++;
    var itemHtml = `
        <div class="item-row" id="item-${itemCounter}">
            <div class="row">
                <div class="col-md-11">
                    <div class="row">
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Item Code</label>
                            <input type="text" class="form-control" name="items[${itemCounter}][item_code]">
                        </div>
                        <div class="col-md-4 mb-2">
                            <label class="form-label">Item Name <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" name="items[${itemCounter}][item_name]" required>
                        </div>
                        <div class="col-md-2 mb-2">
                            <label class="form-label">Quantity <span class="text-danger">*</span></label>
                            <input type="number" class="form-control item-quantity" name="items[${itemCounter}][quantity]" 
                                   value="1" min="1" required onchange="calculateItemTotal(${itemCounter})">
                        </div>
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Unit Price</label>
                            <input type="number" class="form-control item-price" name="items[${itemCounter}][unit_price]" 
                                   value="0" step="0.01" min="0" onchange="calculateItemTotal(${itemCounter})">
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Serial Number</label>
                            <input type="text" class="form-control" name="items[${itemCounter}][serial_number]">
                        </div>
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Batch Number</label>
                            <input type="text" class="form-control" name="items[${itemCounter}][batch_number]">
                        </div>
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Condition</label>
                            <select class="form-select" name="items[${itemCounter}][condition_received]">
                                <option value="good">Good</option>
                                <option value="damaged">Damaged</option>
                                <option value="defective">Defective</option>
                                <option value="incomplete">Incomplete</option>
                            </select>
                        </div>
                        <div class="col-md-3 mb-2">
                            <label class="form-label">Total Price</label>
                            <input type="text" class="form-control item-total" id="total-${itemCounter}" readonly>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-12">
                            <label class="form-label">Description</label>
                            <textarea class="form-control" name="items[${itemCounter}][item_description]" rows="2"></textarea>
                        </div>
                    </div>
                </div>
                <div class="col-md-1 d-flex align-items-center justify-content-center">
                    <button type="button" class="btn btn-danger btn-sm remove-item-btn" 
                            onclick="removeReturnItem(${itemCounter})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    $('#items-container').append(itemHtml);
    updateItemCounter();
}

function removeReturnItem(id) {
    if (confirm('Remove this item?')) {
        $('#item-' + id).remove();
        updateItemCounter();
        calculateTotalValue();
    }
}

function calculateItemTotal(id) {
    var quantity = parseFloat($(`#item-${id} .item-quantity`).val()) || 0;
    var price = parseFloat($(`#item-${id} .item-price`).val()) || 0;
    var total = quantity * price;
    
    $(`#total-${id}`).val(total.toFixed(2));
    calculateTotalValue();
}

function calculateTotalValue() {
    var totalValue = 0;
    var totalItems = 0;
    
    $('.item-row').each(function() {
        var itemTotal = parseFloat($(this).find('.item-total').val()) || 0;
        totalValue += itemTotal;
        totalItems++;
    });
    
    $('#total-value-display').text('Rp ' + totalValue.toLocaleString('id-ID', {minimumFractionDigits: 2}));
    $('#total-items-display').text(totalItems);
}

function updateItemCounter() {
    var count = $('.item-row').length;
    $('#item-count').text(count);
}

// Status update with confirmation
function updateReturnStatus(returnId, newStatus) {
    var reason = prompt('Please enter reason for status change:');
    if (reason === null) return;
    
    $.ajax({
        url: 'api/update-status.php',
        method: 'POST',
        data: {
            return_id: returnId,
            new_status: newStatus,
            reason: reason
        },
        success: function(response) {
            if (response.success) {
                location.reload();
            } else {
                alert('Error: ' + response.message);
            }
        },
        error: function() {
            alert('An error occurred while updating status');
        }
    });
}

// Export table to CSV
function exportTableToCSV(filename) {
    var csv = [];
    var rows = document.querySelectorAll("table tr");
    
    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll("td, th");
        
        for (var j = 0; j < cols.length; j++) {
            var text = cols[j].innerText.replace(/"/g, '""');
            row.push('"' + text + '"');
        }
        
        csv.push(row.join(","));
    }
    
    downloadCSV(csv.join("\n"), filename);
}

function downloadCSV(csv, filename) {
    var csvFile;
    var downloadLink;
    
    csvFile = new Blob([csv], {type: "text/csv"});
    downloadLink = document.createElement("a");
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
}

// Print functionality
function printPage() {
    window.print();
}

// File upload with drag and drop
function initializeFileUpload(elementId) {
    var dropZone = document.getElementById(elementId);
    
    if (!dropZone) return;
    
    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        var files = e.dataTransfer.files;
        handleFiles(files);
    });
}

function handleFiles(files) {
    for (var i = 0; i < files.length; i++) {
        uploadFile(files[i]);
    }
}

// Real-time search filter
function filterTable(inputId, tableId) {
    var input = document.getElementById(inputId);
    var filter = input.value.toUpperCase();
    var table = document.getElementById(tableId);
    var tr = table.getElementsByTagName("tr");
    
    for (var i = 1; i < tr.length; i++) {
        var td = tr[i].getElementsByTagName("td");
        var found = false;
        
        for (var j = 0; j < td.length; j++) {
            if (td[j]) {
                var txtValue = td[j].textContent || td[j].innerText;
                if (txtValue.toUpperCase().indexOf(filter) > -1) {
                    found = true;
                    break;
                }
            }
        }
        
        tr[i].style.display = found ? "" : "none";
    }
}

// Auto-save form data to localStorage
function enableAutoSave(formId) {
    var form = document.getElementById(formId);
    if (!form) return;
    
    // Load saved data
    var savedData = localStorage.getItem(formId);
    if (savedData) {
        var data = JSON.parse(savedData);
        for (var key in data) {
            var input = form.querySelector(`[name="${key}"]`);
            if (input) input.value = data[key];
        }
    }
    
    // Save on input
    form.addEventListener('input', function() {
        var formData = new FormData(form);
        var data = {};
        formData.forEach((value, key) => data[key] = value);
        localStorage.setItem(formId, JSON.stringify(data));
    });
    
    // Clear on submit
    form.addEventListener('submit', function() {
        localStorage.removeItem(formId);
    });
}
