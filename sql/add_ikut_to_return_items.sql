-- Migration to add ikut column to return_items
ALTER TABLE return_items ADD COLUMN ikut VARCHAR(50) DEFAULT NULL AFTER item_category;
