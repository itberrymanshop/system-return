-- Migration to add perbaikan_status to return_items
USE return_management_db;

ALTER TABLE return_items ADD COLUMN perbaikan_status ENUM('pending', 'rekondisi', 'recovery') DEFAULT NULL;

-- Initialize existing pending items to 'pending' if the return is not Completed
UPDATE return_items ri
JOIN returns r ON ri.return_id = r.return_id
SET ri.perbaikan_status = 'pending'
WHERE ri.disposition IN ('rekondisi', 'refurbish') AND r.current_status != 'Completed';
