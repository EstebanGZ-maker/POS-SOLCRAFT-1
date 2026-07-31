INSERT INTO Customers (name, email, phone)
VALUES ('Walk-in Customer', NULL, NULL)
ON CONFLICT (name) DO NOTHING;
