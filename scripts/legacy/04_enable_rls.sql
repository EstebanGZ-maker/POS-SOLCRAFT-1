-- Enable Row Level Security (RLS) for better security
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (you can modify these based on your needs)
-- For now, we'll allow all operations for authenticated users

-- Customers policies
CREATE POLICY "Allow all operations for authenticated users on customers" ON customers
    FOR ALL USING (auth.role() = 'authenticated');

-- Products policies  
CREATE POLICY "Allow all operations for authenticated users on products" ON products
    FOR ALL USING (auth.role() = 'authenticated');

-- Sales policies
CREATE POLICY "Allow all operations for authenticated users on sales" ON sales
    FOR ALL USING (auth.role() = 'authenticated');

-- Sale items policies
CREATE POLICY "Allow all operations for authenticated users on sale_items" ON sale_items
    FOR ALL USING (auth.role() = 'authenticated');
