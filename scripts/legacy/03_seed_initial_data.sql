-- Insert Walk-in Customer (default customer)
INSERT INTO customers (name, email, phone) 
VALUES ('Walk-in Customer', NULL, NULL)
ON CONFLICT (email) DO NOTHING;

-- Insert sample products for testing
INSERT INTO products (name, description, price, stock_quantity) VALUES
('Coffee', 'Premium coffee blend', 4.50, 100),
('Tea', 'Organic green tea', 3.25, 80),
('Sandwich', 'Ham and cheese sandwich', 8.99, 50),
('Muffin', 'Blueberry muffin', 3.75, 30),
('Water Bottle', '500ml spring water', 1.99, 200),
('Energy Drink', 'Sugar-free energy drink', 2.99, 75),
('Chips', 'Potato chips', 2.49, 120),
('Chocolate Bar', 'Dark chocolate bar', 3.99, 60)
ON CONFLICT DO NOTHING;

-- Insert sample customers for testing
INSERT INTO customers (name, email, phone) VALUES
('John Doe', 'john.doe@example.com', '+1234567890'),
('Jane Smith', 'jane.smith@example.com', '+1234567891'),
('Bob Johnson', 'bob.johnson@example.com', '+1234567892'),
('Alice Brown', 'alice.brown@example.com', '+1234567893')
ON CONFLICT (email) DO NOTHING;
