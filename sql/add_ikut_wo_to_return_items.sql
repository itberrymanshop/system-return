-- Migration to add ikut_wo column to return_items
ALTER TABLE return_items ADD COLUMN ikut_wo VARCHAR(50) DEFAULT NULL AFTER ikut;
