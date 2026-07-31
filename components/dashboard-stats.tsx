import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getDashboardStats } from "@/lib/actions"
import { Users, Package, DollarSign, AlertTriangle } from "lucide-react"

export default async function DashboardStats() {
  const stats = await getDashboardStats()

  const statsData = [
    {
      title: "Total Customers",
      value: stats.totalCustomers.toString(),
      icon: Users,
      description: "Registered customers",
    },
    {
      title: "Total Products",
      value: stats.totalProducts.toString(),
      icon: Package,
      description: "Products in inventory",
    },
    {
      title: "Today's Revenue",
      value: `$${stats.todayRevenue.toFixed(2)}`,
      icon: DollarSign,
      description: "Sales revenue today",
    },
    {
      title: "Low Stock Items",
      value: stats.lowStockCount.toString(),
      icon: AlertTriangle,
      description: "Products with ≤10 stock",
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statsData.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            <stat.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="text-xs text-muted-foreground">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
