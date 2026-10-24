// The common shadcn/ui parts side by side in Lumen's theme; toggle the theme in the toolbar.
import { Alert, AlertDescription, AlertTitle } from '@columenlabs/lumen-ui/ui/alert';
import { Badge } from '@columenlabs/lumen-ui/ui/badge';
import { Button } from '@columenlabs/lumen-ui/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@columenlabs/lumen-ui/ui/card';
import { Checkbox } from '@columenlabs/lumen-ui/ui/checkbox';
import { Input } from '@columenlabs/lumen-ui/ui/input';
import { Kbd, KbdGroup } from '@columenlabs/lumen-ui/ui/kbd';
import { Label } from '@columenlabs/lumen-ui/ui/label';
import { Progress } from '@columenlabs/lumen-ui/ui/progress';
import { Separator } from '@columenlabs/lumen-ui/ui/separator';
import { Skeleton } from '@columenlabs/lumen-ui/ui/skeleton';
import { Slider } from '@columenlabs/lumen-ui/ui/slider';
import { Spinner } from '@columenlabs/lumen-ui/ui/spinner';
import { Switch } from '@columenlabs/lumen-ui/ui/switch';
import { Textarea } from '@columenlabs/lumen-ui/ui/textarea';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoIcon } from 'lucide-react';

const meta = {
  title: 'Components/Base parts/Gallery',
  parameters: {
    docs: {
      description: {
        component:
          'The common base parts in one place, in the light or dark theme. Each is the shadcn/ui component of the same name; its own docs list every prop.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Buttons and badges</CardTitle>
          <CardDescription>Variants share one height per size.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Save</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">More</Button>
          <Button variant="destructive">Delete</Button>
          <Separator className="my-1" />
          <Badge variant="success">Live</Badge>
          <Badge variant="warning">Late</Badge>
          <Badge variant="info">New</Badge>
          <Badge variant="outline">Draft</Badge>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
          <CardDescription>Inputs, switches and sliders.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="g-name">Name</Label>
            <Input id="g-name" placeholder="Lisbon" />
          </div>
          <Textarea placeholder="Notes" rows={2} />
          <div className="flex items-center gap-2">
            <Switch id="g-on" defaultChecked />
            <Label htmlFor="g-on">On</Label>
            <Checkbox id="g-check" defaultChecked className="ml-4" />
            <Label htmlFor="g-check">Include</Label>
          </div>
          <Slider defaultValue={[40]} max={100} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Progress and loading</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={62} />
          <div className="flex items-center gap-3">
            <Spinner />
            <Skeleton className="h-4 w-40" />
          </div>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </CardContent>
      </Card>
      <Alert>
        <InfoIcon />
        <AlertTitle>Built on shadcn/ui</AlertTitle>
        <AlertDescription>
          These parts come from shadcn/ui, on Radix and Base UI, styled with Tailwind.
        </AlertDescription>
      </Alert>
    </div>
  ),
};
